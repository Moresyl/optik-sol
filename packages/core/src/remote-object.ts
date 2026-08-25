/**
 * Lazy value mirroring, modelled on CDP's `Runtime.RemoteObject`.
 *
 * The classic in-page console mistake is eager stringification: `JSON.stringify` the
 * logged value at log time. That explodes on circular references, silently drops
 * functions/Symbols/BigInt, turns a 100k-element array into a megabyte of string, and
 * renders every class instance as `[object Object]`.
 *
 * Instead we do what real DevTools does:
 *   1. At log time, compute only a *shallow* preview (bounded, cheap, non-throwing).
 *   2. Retain the value behind an opaque `objectId`.
 *   3. Materialise deeper levels on demand via `getProperties(objectId)`.
 *
 * Retention is refcounted and bounded by the owning RingBuffer: when a log entry is
 * evicted it releases its handles, so an app that logs objects forever does not leak.
 */

export type RemoteObjectType =
  'object' | 'function' | 'undefined' | 'string' | 'number' | 'boolean' | 'symbol' | 'bigint';

export type RemoteObjectSubtype =
  | 'array'
  | 'null'
  | 'node'
  | 'regexp'
  | 'date'
  | 'map'
  | 'set'
  | 'weakmap'
  | 'weakset'
  | 'iterator'
  | 'generator'
  | 'error'
  | 'proxy'
  | 'promise'
  | 'typedarray'
  | 'arraybuffer'
  | 'dataview'
  | 'blob'
  | 'formdata'
  | 'url'
  | 'internal#entry';

export interface PropertyPreview {
  name: string;
  type: RemoteObjectType;
  subtype?: RemoteObjectSubtype;
  /** Short scalar rendering, present for primitives. */
  value?: string;
  /** One further level of preview, present for nested objects. */
  valuePreview?: ObjectPreview;
}

export interface EntryPreview {
  key?: ObjectPreview;
  value: ObjectPreview;
}

export interface ObjectPreview {
  type: RemoteObjectType;
  subtype?: RemoteObjectSubtype;
  description: string;
  /** True when properties/entries were truncated. */
  overflow: boolean;
  properties: PropertyPreview[];
  entries?: EntryPreview[];
}

export interface RemoteObject {
  type: RemoteObjectType;
  subtype?: RemoteObjectSubtype;
  className?: string;
  /** Present for JSON-safe primitives only. */
  value?: unknown;
  /** `NaN`, `Infinity`, `-Infinity`, `-0`, `123n` — values JSON cannot carry. */
  unserializableValue?: string;
  description: string;
  /** Opaque handle for `getProperties`. Absent for primitives. */
  objectId?: string;
  preview?: ObjectPreview;
}

export interface PropertyDescriptor {
  name: string;
  value?: RemoteObject;
  writable?: boolean;
  configurable?: boolean;
  enumerable?: boolean;
  /** True for own properties, false for anything walked up the prototype chain. */
  isOwn: boolean;
  /** Getters are not invoked automatically; the UI offers an explicit "invoke" affordance. */
  get?: RemoteObject;
  set?: RemoteObject;
  /** Set when reading the property threw. */
  wasThrown?: string;
  /** Symbol-keyed, index-keyed, or internal (`[[Prototype]]`, `[[PromiseState]]`). */
  keyKind: 'string' | 'index' | 'symbol' | 'internal';
}

export interface PreviewLimits {
  /** Max properties shown inline in a collapsed preview. */
  maxProperties: number;
  /** Max Map/Set entries shown inline. */
  maxEntries: number;
  /** Characters before a string preview is elided. */
  maxStringLength: number;
  /** Depth of nested previews (Chrome uses 1; 2 reads much better on a phone). */
  maxDepth: number;
}

export const DEFAULT_PREVIEW_LIMITS: PreviewLimits = {
  maxProperties: 8,
  maxEntries: 8,
  maxStringLength: 200,
  maxDepth: 2,
};

// ---------------------------------------------------------------------------
// Object registry
// ---------------------------------------------------------------------------

/**
 * Refcounted two-way map between live values and opaque string ids.
 *
 * The same object logged twice must produce the same id (so the UI can dedupe and so
 * expanding one occurrence does not re-walk the object), which is what the WeakMap
 * side provides. The strong Map is what keeps the value alive for later expansion;
 * `release` is driven by RingBuffer eviction so retention stays bounded.
 */
export class ObjectRegistry {
  #byId = new Map<string, { value: object; refs: number }>();
  #idByValue = new WeakMap<object, string>();
  #nextId = 1;

  retain(value: object): string {
    let id = this.#idByValue.get(value);
    if (id !== undefined) {
      const slot = this.#byId.get(id);
      if (slot) {
        slot.refs++;
        return id;
      }
      // Previously released; fall through and mint a fresh id.
    }
    id = `obj:${this.#nextId++}`;
    this.#idByValue.set(value, id);
    this.#byId.set(id, { value, refs: 1 });
    return id;
  }

  resolve(objectId: string): object | undefined {
    return this.#byId.get(objectId)?.value;
  }

  has(objectId: string): boolean {
    return this.#byId.has(objectId);
  }

  release(objectId: string): void {
    const slot = this.#byId.get(objectId);
    if (!slot) return;
    if (--slot.refs <= 0) this.#byId.delete(objectId);
  }

  clear(): void {
    this.#byId.clear();
    this.#idByValue = new WeakMap();
  }

  get size(): number {
    return this.#byId.size;
  }
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * `Object.prototype.toString` is the only tag that survives cross-realm values
 * (an object from an <iframe> fails `instanceof Array` but still tags as `[object Array]`),
 * which matters because hybrid apps and micro-frontends log across realms constantly.
 */
function tagOf(value: unknown): string {
  return Object.prototype.toString.call(value).slice(8, -1);
}

const TYPED_ARRAY_TAGS = new Set([
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float32Array',
  'Float64Array',
  'BigInt64Array',
  'BigUint64Array',
]);

function subtypeOf(value: object): RemoteObjectSubtype | undefined {
  try {
    const tag = tagOf(value);
    switch (tag) {
      case 'Array':
        return 'array';
      case 'RegExp':
        return 'regexp';
      case 'Date':
        return 'date';
      case 'Map':
        return 'map';
      case 'Set':
        return 'set';
      case 'WeakMap':
        return 'weakmap';
      case 'WeakSet':
        return 'weakset';
      case 'Promise':
        return 'promise';
      case 'ArrayBuffer':
      case 'SharedArrayBuffer':
        return 'arraybuffer';
      case 'DataView':
        return 'dataview';
      case 'Blob':
      case 'File':
        return 'blob';
      case 'FormData':
        return 'formdata';
      case 'URL':
      case 'URLSearchParams':
        return 'url';
    }
    if (TYPED_ARRAY_TAGS.has(tag)) return 'typedarray';
    if (isError(value)) return 'error';
    if (isNode(value)) return 'node';
    if (isArrayLike(value)) return 'array';
    if (typeof (value as { next?: unknown }).next === 'function' && Symbol.iterator in value) {
      return 'iterator';
    }
  } catch {
    // Revoked proxies and hostile host objects can throw from every reflection trap.
  }
  return undefined;
}

function isError(value: object): value is Error {
  if (tagOf(value) === 'Error') return true;
  // Cross-realm and subclassed errors: duck-type on the stack/message pair.
  return (
    'stack' in value &&
    'message' in value &&
    typeof (value as Error).stack === 'string' &&
    typeof (value as Error).message === 'string'
  );
}

function isNode(value: object): value is Node {
  return (
    typeof (value as Node).nodeType === 'number' && typeof (value as Node).nodeName === 'string'
  );
}

/** `arguments`, NodeList, HTMLCollection, and friends. */
function isArrayLike(value: object): boolean {
  const tag = tagOf(value);
  if (
    tag === 'Arguments' ||
    tag === 'NodeList' ||
    tag === 'HTMLCollection' ||
    tag === 'DOMTokenList'
  ) {
    return true;
  }
  return false;
}

function constructorNameOf(value: object): string | undefined {
  try {
    const proto = Object.getPrototypeOf(value);
    if (proto === null) return 'Object';
    const ctor = proto.constructor;
    if (typeof ctor === 'function' && ctor.name) return ctor.name;
  } catch {
    // Proxies with a throwing `getPrototypeOf` trap.
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Descriptions
// ---------------------------------------------------------------------------

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '…';
}

/** Renders a primitive the way it should appear in a preview slot (quoted strings, etc.). */
function describePrimitive(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return JSON.stringify(truncate(value, DEFAULT_PREVIEW_LIMITS.maxStringLength));
    case 'bigint':
      return `${value}n`;
    case 'symbol':
      return value.toString();
    case 'undefined':
      return 'undefined';
    case 'number':
      return describeNumber(value);
    default:
      return value === null ? 'null' : String(value);
  }
}

function describeNumber(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  if (value === 0 && Object.is(value, -0)) return '-0';
  return String(value);
}

/** JSON cannot round-trip these, so they travel as a string with a marker flag. */
function unserializableValueOf(value: unknown): string | undefined {
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'NaN';
    if (value === Infinity) return 'Infinity';
    if (value === -Infinity) return '-Infinity';
    if (value === 0 && Object.is(value, -0)) return '-0';
  }
  return undefined;
}

function describeFunction(fn: Function): string {
  const name = fn.name || '';
  let source = '';
  try {
    source = Function.prototype.toString.call(fn);
  } catch {
    return `ƒ ${name}()`;
  }
  if (source.includes('[native code]')) return `ƒ ${name}() { [native code] }`;

  const isClass = /^\s*class[\s{]/.test(source);
  if (isClass) return `class ${name || '(anonymous)'}`;

  // Extract just the parameter list so the collapsed line stays one line.
  const open = source.indexOf('(');
  const close = open === -1 ? -1 : matchParen(source, open);
  const params = open !== -1 && close !== -1 ? source.slice(open, close + 1) : '()';
  const async = /^\s*async\b/.test(source) ? 'async ' : '';
  const generator = /^\s*(async\s+)?function\s*\*/.test(source) ? '*' : '';
  return `${async}ƒ${generator} ${name}${truncate(params.replace(/\s+/g, ' '), 60)}`;
}

function matchParen(source: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i;
  }
  return -1;
}

function describeNode(node: Node): string {
  if (node.nodeType === 3 /* TEXT_NODE */) {
    return `#text ${JSON.stringify(truncate(node.nodeValue ?? '', 40))}`;
  }
  if (node.nodeType === 8 /* COMMENT_NODE */) {
    return `<!--${truncate(node.nodeValue ?? '', 40)}-->`;
  }
  if (node.nodeType === 9 /* DOCUMENT_NODE */) return '#document';
  if (node.nodeType === 11 /* DOCUMENT_FRAGMENT_NODE */) return '#document-fragment';

  const el = node as Element;
  const tag = el.tagName ? el.tagName.toLowerCase() : node.nodeName.toLowerCase();
  let out = tag;
  const id = el.getAttribute?.('id');
  if (id) out += `#${id}`;
  const cls = el.getAttribute?.('class');
  if (cls) out += `.${cls.trim().split(/\s+/).join('.')}`;
  return `<${truncate(out, 80)}>`;
}

function describeObject(value: object, subtype: RemoteObjectSubtype | undefined): string {
  try {
    switch (subtype) {
      case 'array':
        return `${constructorNameOf(value) ?? 'Array'}(${(value as unknown[]).length})`;
      case 'date': {
        const time = (value as Date).getTime();
        return Number.isNaN(time) ? 'Invalid Date' : (value as Date).toISOString();
      }
      case 'regexp':
        return String(value);
      case 'error':
        return (value as Error).stack || `${(value as Error).name}: ${(value as Error).message}`;
      case 'node':
        return describeNode(value as Node);
      case 'map':
      case 'set':
        return `${constructorNameOf(value) ?? (subtype === 'map' ? 'Map' : 'Set')}(${(value as Map<unknown, unknown>).size})`;
      case 'weakmap':
      case 'weakset':
        return constructorNameOf(value) ?? (subtype === 'weakmap' ? 'WeakMap' : 'WeakSet');
      case 'typedarray':
        return `${constructorNameOf(value) ?? 'TypedArray'}(${(value as Uint8Array).length})`;
      case 'arraybuffer':
        return `${constructorNameOf(value) ?? 'ArrayBuffer'}(${(value as ArrayBuffer).byteLength})`;
      case 'dataview':
        return `DataView(${(value as DataView).byteLength})`;
      case 'promise':
        return 'Promise';
      case 'blob':
        return `${constructorNameOf(value) ?? 'Blob'}(${(value as Blob).size})`;
      case 'url':
        return String(value);
    }
  } catch {
    // Getters on exotic hosts objects can throw; fall through to the generic label.
  }
  return constructorNameOf(value) ?? 'Object';
}

// ---------------------------------------------------------------------------
// Preview construction
// ---------------------------------------------------------------------------

/** Subtypes whose description already says everything; inline properties add noise. */
const SELF_DESCRIBING = new Set<RemoteObjectSubtype>([
  'date',
  'regexp',
  'node',
  'weakmap',
  'weakset',
  'arraybuffer',
  'url',
]);

interface PreviewContext {
  limits: PreviewLimits;
  seen: Set<object>;
}

function previewOf(value: unknown, depth: number, ctx: PreviewContext): ObjectPreview {
  const type = typeof value as RemoteObjectType;

  if (value === null) {
    return {
      type: 'object',
      subtype: 'null',
      description: 'null',
      overflow: false,
      properties: [],
    };
  }
  if (type !== 'object' && type !== 'function') {
    return { type, description: describePrimitive(value), overflow: false, properties: [] };
  }

  const object = value as object;

  if (type === 'function') {
    return {
      type: 'function',
      description: describeFunction(object as Function),
      overflow: false,
      properties: [],
    };
  }

  const subtype = subtypeOf(object);
  const description = describeObject(object, subtype);
  const base: ObjectPreview = {
    type: 'object',
    subtype,
    description,
    overflow: false,
    properties: [],
  };

  if (subtype && SELF_DESCRIBING.has(subtype)) return base;

  // Cycle guard: a preview must always terminate, however malformed the graph is.
  if (ctx.seen.has(object)) {
    return { ...base, description: `${description} [Circular]` };
  }
  if (depth >= ctx.limits.maxDepth) return base;

  ctx.seen.add(object);
  try {
    if (subtype === 'map' || subtype === 'set') {
      collectEntries(object, subtype, base, depth, ctx);
    } else {
      collectProperties(object, subtype, base, depth, ctx);
    }
  } catch {
    // Exotic/proxied objects: keep whatever we managed to gather.
  } finally {
    ctx.seen.delete(object);
  }

  return base;
}

function collectEntries(
  object: object,
  subtype: 'map' | 'set',
  out: ObjectPreview,
  depth: number,
  ctx: PreviewContext,
): void {
  const entries: EntryPreview[] = [];
  const iterable = object as Map<unknown, unknown> | Set<unknown>;
  let count = 0;

  for (const item of iterable as Iterable<unknown>) {
    if (count >= ctx.limits.maxEntries) {
      out.overflow = true;
      break;
    }
    if (subtype === 'map') {
      const [key, val] = item as [unknown, unknown];
      entries.push({ key: previewOf(key, depth + 1, ctx), value: previewOf(val, depth + 1, ctx) });
    } else {
      entries.push({ value: previewOf(item, depth + 1, ctx) });
    }
    count++;
  }
  out.entries = entries;
}

function collectProperties(
  object: object,
  subtype: RemoteObjectSubtype | undefined,
  out: ObjectPreview,
  depth: number,
  ctx: PreviewContext,
): void {
  const isIndexed = subtype === 'array' || subtype === 'typedarray';
  const keys = isIndexed ? indexKeys(object) : ownEnumerableKeys(object);

  for (const key of keys) {
    if (out.properties.length >= ctx.limits.maxProperties) {
      out.overflow = true;
      break;
    }
    out.properties.push(propertyPreview(object, key, depth, ctx));
  }

  // An error's own enumerable props are usually empty; its message carries the payload.
  if (subtype === 'error' && out.properties.length === 0) return;
}

function indexKeys(object: object): string[] {
  const length = Math.min((object as ArrayLike<unknown>).length ?? 0, 100);
  const keys: string[] = [];
  for (let i = 0; i < length; i++) keys.push(String(i));
  return keys;
}

function ownEnumerableKeys(object: object): string[] {
  try {
    // `Object.keys` skips non-enumerables and symbols, which is what a preview wants.
    return Object.keys(object);
  } catch {
    return [];
  }
}

function propertyPreview(
  object: object,
  key: string,
  depth: number,
  ctx: PreviewContext,
): PropertyPreview {
  let raw: unknown;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (descriptor && !('value' in descriptor)) {
      // Never invoke a getter during preview: side effects in a debugger are a bug.
      return { name: key, type: 'object', value: '(...)' };
    }
    raw = descriptor ? descriptor.value : (object as Record<string, unknown>)[key];
  } catch {
    return { name: key, type: 'object', value: '(throws)' };
  }

  const type = typeof raw as RemoteObjectType;
  if (raw === null) return { name: key, type: 'object', subtype: 'null', value: 'null' };
  if (type !== 'object' && type !== 'function') {
    return { name: key, type, value: describePrimitive(raw) };
  }

  const nested = previewOf(raw, depth + 1, ctx);
  return {
    name: key,
    type: nested.type,
    subtype: nested.subtype,
    value: nested.description,
    valuePreview: nested,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mirrors a live value into a transportable `RemoteObject`.
 *
 * Objects are retained in `registry` so the UI can expand them later; primitives are
 * inlined and cost nothing.
 */
export function toRemoteObject(
  value: unknown,
  registry: ObjectRegistry,
  limits: PreviewLimits = DEFAULT_PREVIEW_LIMITS,
): RemoteObject {
  if (value === null) {
    return { type: 'object', subtype: 'null', description: 'null', value: null };
  }

  const type = typeof value as RemoteObjectType;

  if (type !== 'object' && type !== 'function') {
    const unserializable = unserializableValueOf(value);
    const out: RemoteObject = { type, description: describePrimitive(value) };
    if (unserializable !== undefined) out.unserializableValue = unserializable;
    else if (type === 'symbol') out.description = String(value);
    else out.value = value;
    return out;
  }

  const object = value as object;
  const subtype = type === 'function' ? undefined : subtypeOf(object);
  const ctx: PreviewContext = { limits, seen: new Set() };

  return {
    type,
    subtype,
    className: constructorNameOf(object),
    description:
      type === 'function' ? describeFunction(object as Function) : describeObject(object, subtype),
    objectId: registry.retain(object),
    preview: previewOf(object, 0, ctx),
  };
}

export interface GetPropertiesOptions {
  /** Skip the prototype chain. Default true. */
  ownProperties?: boolean;
  /** Include non-enumerable properties. Default false. */
  includeNonEnumerable?: boolean;
  /** Invoke getters and report their values. Default false — getters can have side effects. */
  invokeGetters?: boolean;
}

/**
 * Expands one level of an object previously retained via `toRemoteObject`.
 * Returns `null` when the handle has been released (the log line scrolled out of the
 * ring buffer), which the UI renders as a "value no longer retained" affordance.
 */
export function getProperties(
  objectId: string,
  registry: ObjectRegistry,
  options: GetPropertiesOptions = {},
  limits: PreviewLimits = DEFAULT_PREVIEW_LIMITS,
): PropertyDescriptor[] | null {
  const target = registry.resolve(objectId);
  if (target === undefined) return null;

  const { ownProperties = true, includeNonEnumerable = false, invokeGetters = false } = options;
  const out: PropertyDescriptor[] = [];
  // Symbols with the same description are still distinct property keys. Tracking their
  // rendered text (`Symbol(name)`) silently dropped all but the first one.
  const seenNames = new Set<PropertyKey>();

  const subtype = subtypeOf(target);

  // Map/Set expose their payload as synthetic `[[Entries]]`, matching DevTools.
  if (subtype === 'map' || subtype === 'set') {
    let index = 0;
    try {
      for (const item of target as Iterable<unknown>) {
        const entryValue =
          subtype === 'map'
            ? { key: (item as [unknown, unknown])[0], value: (item as [unknown, unknown])[1] }
            : item;
        out.push({
          name: String(index++),
          value: toRemoteObject(entryValue, registry, limits),
          isOwn: true,
          enumerable: true,
          keyKind: 'internal',
        });
      }
    } catch {
      // Consumed or exotic iterator.
    }
  }

  let current: object | null = target;
  let isOwnLevel = true;

  while (current) {
    let names: (string | symbol)[];
    try {
      names = includeNonEnumerable
        ? [...Object.getOwnPropertyNames(current), ...Object.getOwnPropertySymbols(current)]
        : Object.keys(current);
    } catch {
      break;
    }

    for (const name of names) {
      const key = typeof name === 'symbol' ? name.toString() : name;
      if (seenNames.has(name)) continue; // Shadowed by a nearer prototype.
      seenNames.add(name);

      let descriptor: globalThis.PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(current, name as PropertyKey);
      } catch {
        continue;
      }
      if (!descriptor) continue;

      const entry: PropertyDescriptor = {
        name: key,
        isOwn: isOwnLevel,
        writable: descriptor.writable,
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        keyKind: typeof name === 'symbol' ? 'symbol' : /^\d+$/.test(key) ? 'index' : 'string',
      };

      if ('value' in descriptor) {
        entry.value = toRemoteObject(descriptor.value, registry, limits);
      } else {
        if (descriptor.get) entry.get = toRemoteObject(descriptor.get, registry, limits);
        if (descriptor.set) entry.set = toRemoteObject(descriptor.set, registry, limits);
        if (invokeGetters && descriptor.get) {
          try {
            entry.value = toRemoteObject(descriptor.get.call(target), registry, limits);
          } catch (err) {
            entry.wasThrown = err instanceof Error ? err.message : String(err);
          }
        }
      }
      out.push(entry);
    }

    if (ownProperties) break;
    try {
      current = Object.getPrototypeOf(current);
    } catch {
      break;
    }
    isOwnLevel = false;
  }

  // `[[Prototype]]` last, mirroring DevTools' ordering.
  if (ownProperties) {
    try {
      const proto = Object.getPrototypeOf(target);
      if (proto) {
        out.push({
          name: '[[Prototype]]',
          value: toRemoteObject(proto, registry, limits),
          isOwn: false,
          enumerable: false,
          keyKind: 'internal',
        });
      }
    } catch {
      // Proxy with a throwing trap.
    }
  }

  return out;
}
