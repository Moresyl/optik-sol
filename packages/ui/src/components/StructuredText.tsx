import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import {
  detectCodeLanguage,
  parseJsonDocument,
  tokenizeCodeLine,
  type CodeLanguage,
} from '../structured-text';
import { CopyButton, type CopyController } from './Copy';

const COLLAPSED_LINES = 12;
const CODE_PAGE_SIZE = 500;
const TREE_PAGE_SIZE = 100;
const EXPAND_ALL_NODE_LIMIT = 500;
const EXPAND_ALL_DEPTH_LIMIT = 12;

const LANGUAGE_LABELS: Record<CodeLanguage, string> = {
  json: 'JSON',
  javascript: 'JavaScript',
  html: 'HTML',
  xml: 'XML',
  css: 'CSS',
  shell: 'Shell',
  form: 'Form',
  text: '文本',
};

function codeLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

export function HighlightedCode(props: {
  text: string;
  language: CodeLanguage;
  expanded?: boolean;
  wrap?: boolean;
  ariaLabel?: string;
  maxLines?: number;
}): JSX.Element {
  const lines = createMemo(() => codeLines(props.text));
  const visible = createMemo(() => {
    const limit = props.expanded === false ? COLLAPSED_LINES : (props.maxLines ?? lines().length);
    return lines().slice(0, limit);
  });
  const digits = createMemo(() => String(lines().length).length);

  return (
    <div
      class="optik-code selectable font-mono text-base leading-5 overflow-auto [overscroll-behavior:contain]"
      classList={{ 'max-h-96': props.expanded !== false }}
      role={lines().length > 1 ? 'region' : undefined}
      aria-label={
        lines().length > 1
          ? (props.ariaLabel ?? `${LANGUAGE_LABELS[props.language]} 代码`)
          : undefined
      }
    >
      <For each={visible()}>
        {(line, index) => (
          <div
            class="optik-code-line grid min-w-0"
            style={{ 'grid-template-columns': `${digits() + 1}ch minmax(0, 1fr)` }}
          >
            <span class="optik-code-number not-selectable" aria-hidden="true">
              {index() + 1}
            </span>
            <code
              class="px-2 min-w-0"
              classList={{
                'whitespace-pre-wrap wrap-anywhere': props.wrap !== false,
                'whitespace-pre min-w-max': props.wrap === false,
              }}
            >
              <For each={tokenizeCodeLine(line, props.language)}>
                {(token) => <span data-code-token={token.kind}>{token.text}</span>}
              </For>
              {line.length === 0 ? '\u200b' : null}
            </code>
          </div>
        )}
      </For>
      <Show when={lines().length > visible().length}>
        <div class="px-2 py-1 text-fg-tertiary not-selectable">
          还有 {lines().length - visible().length} 行…
        </div>
      </Show>
    </div>
  );
}

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return value !== null && typeof value === 'object';
}

function containerSize(value: Record<string, unknown> | unknown[]): number {
  if (Array.isArray(value)) return value.length;
  let count = 0;
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) count++;
  }
  return count;
}

/** Read only the visible prefix so a huge payload never creates a huge intermediate array. */
function containerEntries(
  value: Record<string, unknown> | unknown[],
  limit: number,
): [string, unknown][] {
  const entries: [string, unknown][] = [];
  if (limit <= 0) return entries;
  if (Array.isArray(value)) {
    const end = Math.min(value.length, limit);
    for (let index = 0; index < end; index++) entries.push([String(index), value[index]]);
    return entries;
  }
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    entries.push([key, value[key]]);
    if (entries.length >= limit) break;
  }
  return entries;
}

function childPath(parent: string, key: string): string {
  return `${parent}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

function stringifyNode(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null) return 'null';
  return String(value);
}

function valueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function collectBranchPaths(value: unknown): { paths: string[]; truncated: boolean } {
  const paths: string[] = [];
  let visited = 0;
  let truncated = false;
  const walk = (node: unknown, path: string, depth: number) => {
    if (visited >= EXPAND_ALL_NODE_LIMIT) {
      truncated = true;
      return;
    }
    visited++;
    if (!isContainer(node)) return;
    if (depth >= EXPAND_ALL_DEPTH_LIMIT) {
      truncated = true;
      return;
    }
    paths.push(path);
    const available = EXPAND_ALL_NODE_LIMIT - visited;
    const children = containerEntries(node, available);
    if (containerSize(node) > children.length) truncated = true;
    for (const [key, child] of children) {
      walk(child, childPath(path, key), depth + 1);
      if (visited >= EXPAND_ALL_NODE_LIMIT) {
        truncated = true;
        break;
      }
    }
  };
  walk(value, '$', 0);
  return { paths, truncated };
}

function JsonNode(props: {
  value: unknown;
  path: string;
  name?: string;
  depth: number;
  open: () => ReadonlySet<string>;
  onToggle: (path: string) => void;
  copier: CopyController;
  label: string;
}): JSX.Element {
  const container = () => isContainer(props.value);
  const count = createMemo(() =>
    container() ? containerSize(props.value as Record<string, unknown>) : 0,
  );
  const expanded = () => props.open().has(props.path);
  const [visibleLimit, setVisibleLimit] = createSignal(TREE_PAGE_SIZE);
  const entries = createMemo(() =>
    container() && expanded()
      ? containerEntries(props.value as Record<string, unknown>, visibleLimit())
      : [],
  );
  const empty = () => count() === 0;
  const summary = () =>
    Array.isArray(props.value) ? `Array(${count()})` : `Object(${count()})`;
  const copyText = () => JSON.stringify(props.value, null, 2) ?? String(props.value);

  return (
    <div class="font-mono text-base leading-5">
      <div
        class="optik-json-row group row-center min-w-0 min-h-6 rounded-sm hover:bg-bg-elevated"
        style={{ 'padding-left': `${props.depth * 12}px` }}
      >
        <Show when={container() && !empty()} fallback={<span class="w-5 shrink-0" />}>
          <span class="w-5 shrink-0 text-center text-fg-tertiary" aria-hidden="true">
            {expanded() ? '▼' : '▶'}
          </span>
        </Show>

        <Show when={props.name !== undefined}>
          <span data-code-token="key" class="shrink-0">
            {JSON.stringify(props.name)}
          </span>
          <span data-code-token="punctuation">: </span>
        </Show>

        <Show
          when={container()}
          fallback={
            <span data-code-token={valueType(props.value)} class="min-w-0 wrap-anywhere">
              {stringifyNode(props.value)}
            </span>
          }
        >
          <span data-code-token="punctuation">{Array.isArray(props.value) ? '[' : '{'}</span>
          <Show when={!empty()}>
            <button
              class="min-h-6 px-1 text-fg-tertiary hover:text-fg-secondary"
              onClick={() => props.onToggle(props.path)}
              aria-label={`${expanded() ? '收起' : '展开'} ${props.name ?? 'JSON 根节点'}`}
              aria-expanded={expanded()}
            >
              {expanded() ? summary() : `${summary()} …`}
            </button>
            <Show when={!expanded()}>
              <span data-code-token="punctuation">
                {Array.isArray(props.value) ? ']' : '}'}
              </span>
            </Show>
          </Show>
          <Show when={empty()}>
            <span data-code-token="punctuation">{Array.isArray(props.value) ? ']' : '}'}</span>
          </Show>
        </Show>

        <Show when={props.depth > 0}>
          <CopyButton
            copier={props.copier}
            text={copyText}
            label={`${props.label} ${props.path}`}
            class="optik-json-copy ml-auto min-h-6 px-1"
          />
        </Show>
      </div>

      <Show when={container() && !empty() && expanded()}>
        <For each={entries()}>
          {([key, value]) => (
            <JsonNode
              value={value}
              path={childPath(props.path, key)}
              name={key}
              depth={props.depth + 1}
              open={props.open}
              onToggle={props.onToggle}
              copier={props.copier}
              label={props.label}
            />
          )}
        </For>
        <Show when={count() > entries().length}>
          <button
            class="min-h-8 text-accent hover:text-fg-secondary"
            style={{ 'margin-left': `${(props.depth + 1) * 12 + 20}px` }}
            onClick={() => setVisibleLimit((limit) => limit + TREE_PAGE_SIZE)}
          >
            再显示 {Math.min(TREE_PAGE_SIZE, count() - entries().length)} 项（剩余{' '}
            {count() - entries().length} 项）
          </button>
        </Show>
        <div
          class="text-fg-tertiary"
          style={{ 'padding-left': `${(props.depth + 1) * 12 + 20}px` }}
          data-code-token="punctuation"
        >
          {Array.isArray(props.value) ? ']' : '}'}
        </div>
      </Show>
    </div>
  );
}

export function JsonTree(props: {
  value: unknown;
  copier: CopyController;
  label: string;
}): JSX.Element {
  const [open, setOpen] = createSignal<ReadonlySet<string>>(new Set(['$']));
  const branches = createMemo(() => collectBranchPaths(props.value));
  const toggle = (path: string) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div class="rounded-md border border-line bg-bg-sunken overflow-hidden">
      <div class="row-center gap-1 px-2 py-1 border-b border-line not-selectable overflow-x-auto no-scrollbar">
        <span class="text-fg-tertiary shrink-0">树形结构</span>
        <span class="flex-1" />
        <button class="icon-btn min-h-8 px-2" onClick={() => setOpen(new Set(branches().paths))}>
          全部展开
        </button>
        <button class="icon-btn min-h-8 px-2" onClick={() => setOpen(new Set())}>
          全部收起
        </button>
      </div>
      <div class="py-1 max-h-96 overflow-auto [overscroll-behavior:contain]">
        <JsonNode
          value={props.value}
          path="$"
          depth={0}
          open={open}
          onToggle={toggle}
          copier={props.copier}
          label={props.label}
        />
      </div>
      <Show when={branches().truncated}>
        <div class="px-2 py-1 border-t border-line text-fg-tertiary not-selectable">
          “全部展开”最多展开 {EXPAND_ALL_NODE_LIMIT} 个节点，避免阻塞被调试页面。
        </div>
      </Show>
    </div>
  );
}

export interface StructuredTextProps {
  text: string;
  mimeType?: string;
  languageHint?: CodeLanguage;
  label: string;
  copier: CopyController;
  /** Long content starts collapsed unless the surrounding detail explicitly opts in. */
  defaultExpanded?: boolean;
  /** Override clipboard content when exact source preservation matters (e.g. storage). */
  copyText?: () => string;
  showReveal?: boolean;
}

export function StructuredTextView(props: StructuredTextProps): JSX.Element {
  const json = createMemo(() => parseJsonDocument(props.text, props.mimeType));
  const hasTree = createMemo(() => isContainer(json()?.value));
  const language = createMemo(() => detectCodeLanguage(props.text, props.mimeType, props.languageHint));
  const displayText = createMemo(() => json()?.formatted ?? props.text);
  const lineCount = createMemo(() => codeLines(displayText()).length);
  const long = createMemo(() => displayText().length > 800 || lineCount() > COLLAPSED_LINES);
  const [mode, setMode] = createSignal<'tree' | 'code'>(hasTree() ? 'tree' : 'code');
  const [expanded, setExpanded] = createSignal(props.defaultExpanded ?? !long());
  const [codeLimit, setCodeLimit] = createSignal(CODE_PAGE_SIZE);
  const [wrap, setWrap] = createSignal(true);

  return (
    <div class="min-w-0">
      <div class="row-center gap-1 mb-1 not-selectable overflow-x-auto no-scrollbar">
        <span class="shrink-0 px-1.5 rounded-sm bg-bg-sunken text-fg-tertiary">
          {LANGUAGE_LABELS[language()]}
        </span>
        <Show when={hasTree()}>
          <button
            class="chip shrink-0"
            classList={{ 'bg-accent text-accent-fg': mode() === 'tree' }}
            aria-pressed={mode() === 'tree'}
            onClick={() => setMode('tree')}
          >
            树形
          </button>
          <button
            class="chip shrink-0"
            classList={{ 'bg-accent text-accent-fg': mode() === 'code' }}
            aria-pressed={mode() === 'code'}
            onClick={() => setMode('code')}
          >
            代码
          </button>
        </Show>
        <Show when={mode() === 'code'}>
          <button
            class="chip shrink-0"
            aria-pressed={wrap()}
            title={wrap() ? '当前自动换行' : '当前保持原始行'}
            onClick={() => setWrap(!wrap())}
          >
            {wrap() ? '不换行' : '自动换行'}
          </button>
          <Show when={long()}>
            <button class="chip shrink-0" onClick={() => setExpanded(!expanded())}>
              {expanded() ? '收起代码' : `展开代码（${lineCount()} 行）`}
            </button>
            <Show when={expanded() && lineCount() > codeLimit()}>
              <button
                class="chip shrink-0"
                onClick={() => setCodeLimit((limit) => limit + CODE_PAGE_SIZE)}
              >
                再显示 {Math.min(CODE_PAGE_SIZE, lineCount() - codeLimit())} 行
              </button>
            </Show>
          </Show>
        </Show>
        <span class="flex-1" />
        <CopyButton
          copier={props.copier}
          text={props.copyText ?? displayText}
          label={props.label}
          class="min-h-8 px-2 text-accent"
        />
        <Show when={props.showReveal !== false}>
          <button
            class="icon-btn min-h-8 px-2"
            onClick={() => props.copier.reveal(props.text, props.label)}
          >
            查看原文
          </button>
        </Show>
      </div>

      <Show
        when={mode() === 'tree' && hasTree() && json()}
        fallback={
          <div class="rounded-md border border-line bg-bg-sunken overflow-hidden">
            <HighlightedCode
              text={displayText()}
              language={language()}
              expanded={expanded() || !long()}
              maxLines={codeLimit()}
              wrap={wrap()}
              ariaLabel={`${props.label}${LANGUAGE_LABELS[language()]}代码`}
            />
          </div>
        }
      >
        {(document) => <JsonTree value={document().value} copier={props.copier} label={props.label} />}
      </Show>
    </div>
  );
}
