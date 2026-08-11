/**
 * 控制台面板。
 *
 * 手机上调试的真实痛点不是"看不到日志"，而是"看到了拿不出来"。所以这里
 * 有三条独立的复制路径，且都不依赖剪贴板 API 可用：
 *  1. 长按任意一行 → 复制该行（原生长按选中同时保留）
 *  2. 勾选模式 → 批量复制选中行
 *  3. 顶部「导出」→ 一次性拿走全部（含时间戳与来源）
 */

import { createSignal, createEffect, For, Show, on, type JSX } from 'solid-js';
import type { LogEntry, LogLevel, OptikKernel, RemoteObject } from '@optik/core';
import { ALL_LEVELS, LEVEL_LABELS, type Store } from '../store';
import { ValueView } from './Value';
import { onLongPress } from '../platform/gesture';
import { useLayout } from '../layout';
import type { CopyController } from './Copy';

/** 等级 → 配色类名。数据驱动，因此这些类名进了 uno 的 safelist。 */
const LEVEL_CLASS: Record<LogLevel, string> = {
  debug: 'text-debug',
  log: '',
  info: 'text-info',
  warn: 'text-warn bg-warn-bg',
  error: 'text-danger bg-danger-bg',
};

const ORIGIN_LABELS: Record<string, string> = {
  exception: '异常',
  unhandledrejection: '未处理拒绝',
  'resource-error': '资源加载失败',
  'csp-violation': 'CSP 违规',
  user: '手动',
};

/** 把命中的片段包成 <mark>，用于搜索高亮。 */
function highlight(text: string, query: string, useRegex: boolean): JSX.Element {
  if (!query) return text;

  let pattern: RegExp;
  try {
    pattern = new RegExp(useRegex ? query : escapeRegex(query), 'gi');
  } catch {
    // 正则输入到一半（例如 `\d{`）时不该让整行消失，退化为纯文本。
    pattern = new RegExp(escapeRegex(query), 'gi');
  }

  const parts: JSX.Element[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    // 零宽匹配会导致死循环，直接放弃高亮。
    if (match[0].length === 0) return text;
    if (index > last) parts.push(text.slice(last, index));
    parts.push(<mark class="optik-hit">{match[0]}</mark>);
    last = index + match[0].length;
  }
  if (parts.length === 0) return text;
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/** 单条日志导出为纯文本，带时间戳与来源标注。 */
function entryToText(entry: LogEntry): string {
  const origin = ORIGIN_LABELS[entry.origin];
  const prefix = `[${formatTime(entry.timestamp)}] [${LEVEL_LABELS[entry.level]}]${origin ? ` [${origin}]` : ''}`;
  const stack = entry.stackTrace?.length
    ? '\n' + entry.stackTrace.map((f) => `    at ${f.functionName || '(匿名)'} (${f.url}:${f.lineNumber}:${f.columnNumber})`).join('\n')
    : '';
  return `${prefix} ${entry.text}${stack}`;
}

function LogRow(props: {
  entry: LogEntry;
  store: Store;
  kernel: OptikKernel;
  copier: CopyController;
}): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);

  /**
   * 长按复制本行。注意这里用的是纯观察型手势——它不 preventDefault，
   * 所以系统原生的"长按选中文字"依然可用，两条路互不干扰。
   */
  const attachLongPress = (element: HTMLElement) => {
    const dispose = onLongPress(element, {
      onLongPress: () => props.copier.copy(entryToText(props.entry), '此行'),
    });
    // Solid 的 ref 回调没有 onCleanup 上下文，挂到元素上由面板卸载时统一清理。
    (element as HTMLElement & { __optikDispose?: () => void }).__optikDispose = dispose;
  };

  const layout = useLayout();
  const selected = () => props.store.selection().has(props.entry.id);
  /** 有可展开参数（对象/数组/函数）时才提供结构化视图。 */
  const hasStructured = () =>
    props.entry.args.some((arg: RemoteObject) => arg.objectId !== undefined);

  return (
    <div
      ref={attachLongPress}
      class={`flex items-stretch border-b border-line ${LEVEL_CLASS[props.entry.level]}`}
    >
      <Show when={props.store.selectionMode()}>
        <button
          class="shrink-0 w-6 h-6 mt-1.5 ml-3 rounded border border-line-strong row-center justify-center text-sm not-selectable"
          classList={{ 'bg-accent border-accent text-accent-fg': selected() }}
          aria-label={selected() ? '取消选择' : '选择'}
          onClick={() => props.store.toggleSelected(props.entry.id)}
        >
          {selected() ? '✓' : ''}
        </button>
      </Show>

      <div class="min-w-0 flex-1 px-3 py-1.5">
        <div class="row-center gap-1.5 text-2xs text-fg-tertiary not-selectable">
          <span>{formatTime(props.entry.timestamp)}</span>
          <Show when={ORIGIN_LABELS[props.entry.origin]}>
            {(label) => (
              <span class="px-1 rounded-sm bg-bg-sunken">{label()}</span>
            )}
          </Show>
          <Show when={props.entry.channel}>
            {(channel) => <span class="px-1 rounded-sm bg-bg-sunken">{channel()}</span>}
          </Show>
          <Show when={props.entry.repeatCount > 1}>
            <span class="px-1.5 rounded-full bg-accent text-accent-fg">{props.entry.repeatCount}</span>
          </Show>
        </div>

        {/* 折叠视图：一行纯文本，可选中、可搜索高亮。 */}
        <Show when={!expanded()}>
          <div
            class="selectable wrap-anywhere font-mono text-base leading-5"
            style={{ 'padding-left': `${props.entry.groupDepth * 12}px` }}
          >
            <Show
              when={props.entry.styledParts}
              fallback={highlight(props.entry.text, props.store.filter().query, props.store.filter().useRegex)}
            >
              {(parts) => (
                <For each={parts()}>
                  {(part) => <span style={part.css}>{part.text}</span>}
                </For>
              )}
            </Show>
          </div>
        </Show>

        {/* 展开视图：每个参数一棵可下钻的对象树。 */}
        <Show when={expanded()}>
          <For each={props.entry.args}>
            {(arg) => <ValueView value={arg} kernel={props.kernel} />}
          </For>
        </Show>

        <Show when={props.entry.stackTrace?.length}>
          <details class="mt-1">
            <summary class="text-2xs text-fg-tertiary not-selectable cursor-pointer py-1">
              调用栈（{props.entry.stackTrace!.length} 帧）
            </summary>
            <div class="selectable font-mono text-2xs text-fg-secondary leading-4 pl-2 wrap-anywhere">
              <For each={props.entry.stackTrace}>
                {(frame) => (
                  <div>
                    at {frame.functionName || '(匿名)'} ({frame.url}:{frame.lineNumber}:{frame.columnNumber})
                  </div>
                )}
              </For>
            </div>
          </details>
        </Show>

        {/* 「复制」已经移到行尾常驻列，这里只剩展开开关，没有可展开参数时整行不占高度 */}
        <Show when={hasStructured()}>
          <div class="row-center gap-3 mt-1 text-2xs not-selectable">
            <button class="text-accent py-1" onClick={() => setExpanded(!expanded())}>
              {expanded() ? '收起' : '展开对象'}
            </button>
          </div>
        </Show>
      </div>

      {/*
        行尾常驻的复制列。位置固定，不随内容长短漂移，一列扫下来都在同一个 x 上。
        贴顶对齐（items-start）是因为一条报错展开调用栈后能有十几行高，
        按钮跟着跑到中间就找不着了；但命中区仍是整行高度。
      */}
      <button
        class={`shrink-0 ${layout.dense() ? 'w-10' : 'w-11'} flex justify-center items-start pt-1.5
                border-l border-line text-2xs text-fg-tertiary not-selectable active:bg-bg-sunken`}
        title="复制此行（含时间戳与调用栈）"
        aria-label="复制此行"
        onClick={() => props.copier.copy(entryToText(props.entry), '此行')}
      >
        复制
      </button>
    </div>
  );
}

export function ConsolePanel(props: {
  store: Store;
  kernel: OptikKernel;
  copier: CopyController;
}): JSX.Element {
  const [input, setInput] = createSignal('');
  const [history, setHistory] = createSignal<string[]>([]);
  const [autoScroll, setAutoScroll] = createSignal(true);
  let scroller: HTMLDivElement | undefined;

  /**
   * 只有当用户本来就贴在底部时才自动滚动。否则用户往回翻看历史时
   * 会被新日志不断拽回底部，这是同类工具最招人烦的行为之一。
   */
  const onScroll = () => {
    if (!scroller) return;
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    setAutoScroll(distance < 40);
  };

  createEffect(
    on(props.store.visibleLogs, () => {
      if (!autoScroll() || !scroller) return;
      requestAnimationFrame(() => {
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
      });
    }),
  );

  const run = () => {
    const expression = input().trim();
    if (!expression) return;

    setHistory((previous) => [expression, ...previous.filter((item) => item !== expression)].slice(0, 50));
    setInput('');

    // 先把输入本身作为一条日志记下来，回显才有上下文。
    props.kernel.log.ingest({ level: 'log', origin: 'user', args: [`› ${expression}`] });

    const result = props.kernel.evaluate(expression);
    if (result.thrown) {
      props.kernel.log.ingest({ level: 'error', origin: 'user', args: [result.thrown.description ?? '执行出错'] });
    } else {
      props.kernel.log.ingest({ level: 'info', origin: 'user', args: [result.value?.description ?? 'undefined'] });
    }
  };

  const copySelected = () => {
    const ids = props.store.selection();
    const text = props.store
      .logs()
      .filter((entry) => ids.has(entry.id))
      .map(entryToText)
      .join('\n');
    props.copier.copy(text, `${ids.size} 条日志`);
  };

  const exportAll = () => {
    const text = props.store.visibleLogs().map(entryToText).join('\n');
    props.copier.copy(text, `${props.store.visibleLogs().length} 条日志`);
  };

  return (
    <div class="flex flex-col h-full min-h-0">
      {/* 工具条 */}
      <div class="shrink-0 border-b border-line bg-bg-elevated">
        <div class="row-center gap-1 px-2 py-1.5 overflow-x-auto no-scrollbar">
          <For each={ALL_LEVELS}>
            {(level) => (
              <button
                class="chip shrink-0"
                classList={{ 'bg-accent text-accent-fg': props.store.filter().levels.has(level) }}
                onClick={() => props.store.toggleLevel(level)}
              >
                {LEVEL_LABELS[level]}
              </button>
            )}
          </For>
        </div>

        <div class="row-center gap-1.5 px-2 pb-1.5">
          {/* 16px 字号：低于此值 iOS Safari 会在聚焦时强制放大整个页面。 */}
          <input
            class="flex-1 min-w-0 px-2.5 min-h-9 rounded-md bg-bg border border-line text-input selectable"
            type="search"
            inputmode="search"
            placeholder="搜索日志…"
            autocapitalize="off"
            autocorrect="off"
            spellcheck={false}
            value={props.store.filter().query}
            onInput={(event) => props.store.setQuery(event.currentTarget.value)}
          />
          <button
            class="chip shrink-0 font-mono"
            classList={{ 'bg-accent text-accent-fg': props.store.filter().useRegex }}
            title="正则匹配"
            onClick={props.store.toggleRegex}
          >
            .*
          </button>
        </div>

        <div class="row-center gap-2 px-2 pb-1.5 text-2xs not-selectable overflow-x-auto no-scrollbar">
          <span class="text-fg-tertiary shrink-0">
            {props.store.visibleLogs().length}/{props.store.logs().length} 条
          </span>
          <button
            class="chip shrink-0"
            classList={{ 'bg-accent text-accent-fg': props.store.selectionMode() }}
            onClick={() => {
              props.store.setSelectionMode(!props.store.selectionMode());
              props.store.clearSelection();
            }}
          >
            {props.store.selectionMode() ? '退出勾选' : '勾选'}
          </button>
          <Show when={props.store.selectionMode() && props.store.selection().size > 0}>
            <button class="chip shrink-0 text-accent" onClick={copySelected}>
              复制选中（{props.store.selection().size}）
            </button>
          </Show>
          <button class="chip shrink-0" onClick={exportAll}>
            导出全部
          </button>
          <button class="chip shrink-0 text-danger" onClick={props.store.clearLogs}>
            清空
          </button>
        </div>
      </div>

      {/* 日志列表 */}
      <div class="flex-1 min-h-0 relative">
      <div
        ref={scroller}
        onScroll={onScroll}
        class="h-full overflow-y-auto [overscroll-behavior:contain]
               [-webkit-overflow-scrolling:touch] [touch-action:pan-y]"
      >
        <Show
          when={props.store.visibleLogs().length > 0}
          fallback={
            <div class="p-8 text-center text-fg-tertiary text-base not-selectable">
              {props.store.logs().length === 0 ? '暂无日志' : '没有匹配的日志'}
            </div>
          }
        >
          <For each={props.store.visibleLogs()}>
            {(entry) => (
              <LogRow entry={entry} store={props.store} kernel={props.kernel} copier={props.copier} />
            )}
          </For>
        </Show>
      </div>

        {/*
          往回翻历史时自动跟随会停掉，此时新日志还在进。给一个回到底部的入口，
          而不是像别的工具那样在底部常驻一排「Top / Bottom」白占高度——
          贴着底部的时候这个按钮根本不需要存在。
        */}
        <Show when={!autoScroll() && props.store.visibleLogs().length > 0}>
          <button
            class="absolute right-3 bottom-3 px-3 min-h-9 rounded-full not-selectable
                   bg-accent text-accent-fg text-2xs [box-shadow:0_2px_8px_rgba(0,0,0,0.25)]"
            onClick={() => {
              if (scroller) scroller.scrollTop = scroller.scrollHeight;
              setAutoScroll(true);
            }}
          >
            ↓ 最新
          </button>
        </Show>
      </div>

      {/* REPL */}
      <div class="shrink-0 row-center gap-1.5 px-2 py-1.5 border-t border-line bg-bg-elevated">
        <span class="text-accent font-mono text-md not-selectable">›</span>
        <input
          class="flex-1 min-w-0 px-2 min-h-9 rounded-md bg-bg border border-line font-mono text-input selectable"
          placeholder="输入表达式，回车执行"
          autocapitalize="off"
          autocorrect="off"
          autocomplete="off"
          spellcheck={false}
          value={input()}
          onInput={(event) => setInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              run();
            } else if (event.key === 'ArrowUp' && history().length > 0) {
              event.preventDefault();
              setInput(history()[0]);
            }
          }}
        />
        <button class="btn-primary shrink-0" onClick={run}>
          执行
        </button>
      </div>
    </div>
  );
}
