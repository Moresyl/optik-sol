/**
 * RemoteObject 渲染器：惰性展开的对象树。
 *
 * 关键点在于**从不把被调试的对象整体序列化一遍**。内核在日志产生时只做了一层浅预览，
 * 真实对象留在 ObjectRegistry 里由 objectId 引用。用户点开某个节点时，
 * 才通过 `getProperties(objectId)` 取下一层。所以：
 *  - 循环引用不会栈溢出
 *  - 十万元素的数组不会卡死主线程
 *  - 函数、Symbol、BigInt、DOM 节点都能如实显示，而不是变成 `{}` 或被丢弃
 *
 * 句柄的生命周期跟着环形缓冲走：日志被挤出缓冲区时对应对象即被释放，
 * 此时展开会拿到 null，界面显示「值已释放」而不是静默失败。
 *
 * 唯一的例外是「字符串里装着 JSON」，见 tryParseJson。
 */

import { createSignal, For, Show, onCleanup, type JSX } from 'solid-js';
import { remoteObjectToText, toRemoteObject } from 'optik-core';
import type {
  GetPropertiesOptions,
  ObjectRegistry,
  OptikKernel,
  PropertyDescriptor,
  RemoteObject,
} from 'optik-core';
import { scheduleFrame } from '../platform/frame';

/**
 * 能把 objectId 解回对象的域。日志域和网络域都是这个形状。
 *
 * 之所以要把它做成一个参数而不是写死 `kernel.log`：每个域各自持有一份注册表，
 * 各自从 `obj:1` 开始编号。同一个 `obj:3` 在日志域和网络域里指的是**两个不相干的对象**。
 * 拿着网络域给的 RemoteObject 去日志域里展开，不会报错，只会安安静静地
 * 把另一个对象的属性列出来——比崩溃难发现得多。
 */
export interface ValueDomain {
  readonly registry: ObjectRegistry;
  getProperties(objectId: string, options?: GetPropertiesOptions): PropertyDescriptor[] | null;
}

export interface ValueProps {
  value: RemoteObject;
  kernel: OptikKernel;
  /** 这个值归哪个域管。不传按日志域处理——控制台是绝大多数场景。 */
  domain?: ValueDomain;
  /** 顶层内联渲染（日志行内）不显示展开箭头以外的缩进。 */
  depth?: number;
  /** 属性名，作为子节点渲染时显示在值前面。 */
  name?: string;
  /** 不可枚举属性以更淡的颜色显示。 */
  dim?: boolean;
  /**
   * 挂载时就展开这一层（只作用于根节点，子节点仍然惰性）。
   * 用在 REPL 结果上：用户刚刚主动求了一个值，答案不该还要再点一次才看得到。
   */
  defaultExpanded?: boolean;
  onCopy?: (text: string) => void;
}

/** 属性描述符里没有值时（例如纯 setter）用它占位。 */
const UNDEFINED_VALUE: RemoteObject = { type: 'undefined', description: 'undefined' };

/** 是否是可以继续展开的节点。 */
function isExpandable(value: RemoteObject): boolean {
  return value.type === 'object' && value.objectId !== undefined && value.subtype !== 'null';
}

/**
 * 大于这个长度就不试探了。
 *
 * 判断一段文本是不是 JSON，除了真的 parse 一遍没有别的可靠办法，而 parse 的代价
 * 跟长度成正比。1MB 已经远超「顺手看一眼」的范畴——那种体量的字符串真要看结构，
 * 该走的是网络面板的响应体，不是日志行里的一个叶子节点。
 */
const JSON_PROBE_LIMIT = 1_000_000;

/**
 * 字符串里装着的 JSON——解出来返回值，不是就返回 undefined。
 *
 * 这是整个面板里绕不开的一件事：localStorage / sessionStorage / Cookie 只能存字符串，
 * 而实际写进去的十有八九是 `JSON.stringify` 过的对象。于是 `Object.entries(localStorage)`
 * 这类求值，结果树里每一个叶子都是 `"{\"id\":42,\"name\":\"张三\"}"` 这种反斜杠汤：
 * 值就在眼前，却要用户自己在脑子里反转义。
 *
 * 先看首尾字符再决定要不要 parse。对满屏的普通字符串挨个跑 try/catch 是白费，
 * 而且异常在某些 WebView 里并不便宜。首尾都对上才交给 parser——
 * 这一步只做筛选，`{ 不是 JSON` 这种会在 parse 里被正常否掉。
 *
 * 注意只认对象和数组。裸的 `123`、`true`、`"abc"` 也是合法 JSON，但把字符串 `"123"`
 * 显示成数字 123 是在改写事实，而且它们本来就已经看得清清楚楚了。
 *
 * StoragePanel 的 prettify() 做的是同一件事的另一半——那边要的是缩进后的文本，
 * 这边要的是可展开的树，所以没合并成一个函数。
 */
function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length < 2 || trimmed.length > JSON_PROBE_LIMIT) return undefined;
  const head = trimmed[0];
  const tail = trimmed[trimmed.length - 1];
  if (!((head === '{' && tail === '}') || (head === '[' && tail === ']'))) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/**
 * 单行摘要文本，未展开时显示。
 *
 * 对象走 `remoteObjectToText`——它读的是内核在写日志那一刻算好的浅预览，
 * 渲染成 `Object {token: "eyJ…", user: "…", …}`。之前这里直接用 `description`，
 * 那是构造函数名，于是一个折叠的对象节点在屏幕上就只有孤零零一个「Object」：
 * 想知道里面是什么，只能先点开。这一层预览本来就已经算好了，白放着不用而已。
 */
function summarize(value: RemoteObject): string {
  if (value.type === 'string') return JSON.stringify(value.value);
  if (isExpandable(value) || value.type === 'function') return remoteObjectToText(value);
  if (value.description !== undefined) return value.description;
  if (value.type === 'undefined') return 'undefined';
  if (value.subtype === 'null') return 'null';
  return String(value.value);
}

export function ValueView(props: ValueProps): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);
  const [children, setChildren] = createSignal<PropertyDescriptor[] | null>(null);
  const [released, setReleased] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  let cancelPending: (() => void) | undefined;
  let disposed = false;

  const depth = () => props.depth ?? 0;
  const domain = (): ValueDomain => props.domain ?? props.kernel.log;

  /**
   * 这个节点是「一段刚好是 JSON 的字符串」时，把解出来的值也镜像进注册表，
   * 于是它跟任何别的对象一样有 objectId，能直接交给下面那套惰性展开的逻辑用。
   *
   * 只算一次，不用 createMemo：一个 ValueView 实例对应树上固定的一个节点，
   * props.value 不会中途换成别的值（父层重新取属性时整棵子树是重建的）。
   * 而 createMemo 是惰性的，onCleanup 里再去读它反而会把没算过的强行算出来。
   */
  const jsonMirror = (() => {
    if (props.value.type !== 'string' || typeof props.value.value !== 'string') return undefined;
    const parsed = tryParseJson(props.value.value);
    if (parsed === undefined) return undefined;
    // 必须镜像进**这棵树所属的**注册表，否则拿到的 id 到时候会在另一个域里解引用。
    return toRemoteObject(parsed, domain().registry);
  })();

  /** 归还 getProperties 为这一层每个描述符借来的句柄。 */
  const releaseProperties = (properties: PropertyDescriptor[] | null): void => {
    for (const property of properties ?? []) {
      for (const child of [property.value, property.get, property.set]) {
        if (child?.objectId !== undefined) domain().registry.release(child.objectId);
      }
    }
  };

  // 这份句柄是这个组件自己借的（解析出来的副本没有别人引用），谁借谁还。
  onCleanup(() => {
    disposed = true;
    cancelPending?.();
    releaseProperties(children());
    if (jsonMirror?.objectId !== undefined) domain().registry.release(jsonMirror.objectId);
  });

  /** 实际拿来取属性的对象：JSON 字符串取它的解析结果，其余取自己。 */
  const target = () => jsonMirror ?? props.value;
  const expandable = () => jsonMirror !== undefined || isExpandable(props.value);

  const load = () => {
    if (children() !== null || released()) return;
    setLoading(true);
    // 取属性可能触发 getter 求值，放到下一帧避免阻塞本次点击的视觉反馈。
    cancelPending = scheduleFrame(() => {
      cancelPending = undefined;
      if (disposed) return;
      // 不展开原型链、也不调用 getter：在调试器里触发副作用是不可接受的，
      // getter 会以 `(...)` 占位显示，用户想看再单独求值。
      const result = domain().getProperties(target().objectId!, {
        ownProperties: true,
        includeNonEnumerable: true,
        invokeGetters: false,
      });
      if (disposed) {
        releaseProperties(result);
        return;
      }
      setLoading(false);
      if (result === null) setReleased(true);
      else setChildren(result);
    });
  };

  const toggle = () => {
    if (!expandable()) return;
    if (expanded()) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    load();
  };

  if (props.defaultExpanded && expandable()) {
    setExpanded(true);
    load();
  }

  return (
    <div class="font-mono text-base leading-5">
      <div
        class="row-center gap-1 min-h-6 wrap-anywhere selectable"
        style={{ 'padding-left': `${depth() * 12}px` }}
      >
        <Show when={expandable()} fallback={<span class="w-3 shrink-0" />}>
          {/*
            展开箭头单独做成 44px 触控区（用负 margin 让视觉尺寸仍然是小三角），
            否则手机上极难点中。
          */}
          <button
            class="shrink-0 w-3 h-6 -my-2.5 py-2.5 text-fg-tertiary not-selectable row-center justify-center"
            aria-expanded={expanded()}
            aria-label={expanded() ? '收起' : '展开'}
            onClick={toggle}
          >
            {expanded() ? '▼' : '▶'}
          </button>
        </Show>

        <Show when={props.name !== undefined}>
          <span
            class="shrink-0"
            style={{ color: props.dim ? 'var(--optik-text-tertiary)' : 'var(--optik-token-key)' }}
          >
            {props.name}
            <span class="text-fg-tertiary">: </span>
          </span>
        </Show>

        {/*
          JSON 字符串挂一个标记再显示解析后的预览。标记不能省：这个值**真的是字符串**，
          `typeof` 是 'string'、长度是带引号和反斜杠的那个长度。直接把它显示成对象，
          用户照着写 `x.id` 就会拿到 undefined，而屏幕上看不出任何线索。
          有了这两个字，看到的是解析结果，知道的是原样。
        */}
        <Show when={jsonMirror !== undefined}>
          <span class="shrink-0 px-1 rounded-sm bg-bg-sunken text-fg-tertiary not-selectable">
            JSON
          </span>
        </Show>

        <span
          data-type={props.value.type}
          data-subtype={props.value.subtype}
          data-json={jsonMirror !== undefined ? 'true' : undefined}
          class="wrap-anywhere"
          onClick={expandable() ? toggle : undefined}
        >
          {jsonMirror !== undefined ? remoteObjectToText(jsonMirror) : summarize(props.value)}
        </span>
      </div>

      <Show when={expanded()}>
        <Show when={loading()}>
          <div class="text-fg-tertiary py-1" style={{ 'padding-left': `${(depth() + 1) * 12}px` }}>
            读取中…
          </div>
        </Show>

        <Show when={released()}>
          <div class="text-fg-tertiary py-1" style={{ 'padding-left': `${(depth() + 1) * 12}px` }}>
            值已释放（该条日志已超出缓冲区上限，原始对象不再被引用）
          </div>
        </Show>

        <For each={children() ?? []}>
          {(property) => (
            <ValueView
              value={property.value ?? UNDEFINED_VALUE}
              kernel={props.kernel}
              domain={props.domain}
              depth={depth() + 1}
              name={property.name}
              dim={!property.enumerable}
              onCopy={props.onCopy}
            />
          )}
        </For>

        <Show when={children()?.length === 0}>
          <div class="text-fg-tertiary py-1" style={{ 'padding-left': `${(depth() + 1) * 12}px` }}>
            无自有属性
          </div>
        </Show>
      </Show>
    </div>
  );
}

/**
 * 内联单值渲染：日志行内的多个参数横向排开，不带树结构。
 * 点击后由外层切换到展开视图。
 */
export function InlineValue(props: { value: RemoteObject }): JSX.Element {
  return (
    <span data-type={props.value.type} data-subtype={props.value.subtype} class="wrap-anywhere">
      {props.value.type === 'string' ? (props.value.value as string) : summarize(props.value)}
    </span>
  );
}
