/**
 * 网络面板。
 *
 * 除了常规的请求列表，这里还给出了同类工具普遍没有的三样东西：
 *  - **分段耗时**（DNS / TCP / TLS / 等待 / 下载），来自 Resource Timing
 *  - **WebSocket 帧**逐条记录，收发方向分明
 *  - **复制为 cURL**，把手机上抓到的请求直接搬到电脑上重放
 */

import { createSignal, For, Show, createMemo, type JSX } from 'solid-js';
import type { NetworkRecord, NetworkBody, OptikKernel, RequestInitiator } from '@optik/core';
import type { Store } from '../store';
import type { CopyController } from './Copy';
import { ValueView } from './Value';
import { SplitView } from './SplitView';
import { useLayout } from '../layout';

const INITIATOR_LABELS: Record<RequestInitiator, string> = {
  xhr: 'XHR',
  fetch: 'Fetch',
  beacon: 'Beacon',
  websocket: 'WS',
  eventsource: 'SSE',
  resource: '资源',
};

const OMITTED_REASONS: Record<string, string> = {
  'too-large': '内容过大，未保留',
  binary: '二进制内容，未保留',
  streaming: '流式响应，未保留',
  unavailable: '无法读取',
  opaque: '跨域不透明响应，浏览器不允许读取',
};

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** 状态码 → 颜色。失败与 4xx/5xx 一眼可辨，这是列表最重要的信息。 */
function statusClass(record: NetworkRecord): string {
  if (record.phase === 'failed') return 'text-danger';
  if (record.phase === 'aborted') return 'text-warn';
  if (record.phase !== 'complete') return 'text-fg-tertiary';
  const status = record.status ?? 0;
  if (status >= 500) return 'text-danger';
  if (status >= 400) return 'text-warn';
  return 'text-fg-secondary';
}

function statusText(record: NetworkRecord): string {
  if (record.phase === 'failed') return '失败';
  if (record.phase === 'aborted') return '已取消';
  if (record.phase === 'pending' || record.phase === 'loading') return '进行中';
  return String(record.status ?? '—');
}

/**
 * 生成 cURL 命令。单引号转义按 shell 规则（'\'' 收尾再起一个引号），
 * 保证包含引号的 body 也能原样粘贴执行。
 */
function toCurl(record: NetworkRecord): string {
  const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;
  const parts = [`curl -X ${record.method} ${quote(record.url)}`];
  for (const [name, value] of record.requestHeaders) {
    parts.push(`  -H ${quote(`${name}: ${value}`)}`);
  }
  if (record.requestBody?.text) parts.push(`  --data-raw ${quote(record.requestBody.text)}`);
  return parts.join(' \\\n');
}

function recordToText(record: NetworkRecord): string {
  const lines = [
    `${record.method} ${record.url}`,
    `状态：${statusText(record)}${record.statusText ? ` ${record.statusText}` : ''}`,
    `耗时：${formatDuration(record.timing.duration)}`,
    '',
    '--- 请求头 ---',
    ...record.requestHeaders.map(([name, value]) => `${name}: ${value}`),
  ];
  if (record.requestBody?.text) lines.push('', '--- 请求体 ---', record.requestBody.text);
  lines.push('', '--- 响应头 ---', ...record.responseHeaders.map(([name, value]) => `${name}: ${value}`));
  if (record.responseBody?.text) lines.push('', '--- 响应体 ---', record.responseBody.text);
  if (record.error) lines.push('', `错误：${record.error}`);
  return lines.join('\n');
}

function Section(props: { title: string; children: JSX.Element; action?: JSX.Element }): JSX.Element {
  return (
    <div class="border-b border-line">
      <div class="row-center justify-between px-3 py-2 bg-bg-elevated not-selectable">
        <span class="text-sm font-600 text-fg-secondary">{props.title}</span>
        {props.action}
      </div>
      <div class="px-3 py-2">{props.children}</div>
    </div>
  );
}

function KeyValueList(props: { items: [string, string][] }): JSX.Element {
  return (
    <Show
      when={props.items.length > 0}
      fallback={<div class="text-sm text-fg-tertiary not-selectable">（无）</div>}
    >
      <For each={props.items}>
        {([name, value]) => (
          <div class="selectable wrap-anywhere font-mono text-sm leading-5 py-0.5">
            <span style={{ color: 'var(--optik-token-key)' }}>{name}</span>
            <span class="text-fg-tertiary">: </span>
            <span>{value}</span>
          </div>
        )}
      </For>
    </Show>
  );
}

function BodyView(props: {
  body: NetworkBody | undefined;
  kernel: OptikKernel;
  copier: CopyController;
  label: string;
}): JSX.Element {
  return (
    <Show
      when={props.body}
      fallback={<div class="text-sm text-fg-tertiary not-selectable">（无）</div>}
    >
      {(body) => (
        <>
          <Show when={body().omitted}>
            <div class="text-sm text-warn not-selectable">
              {OMITTED_REASONS[body().omittedReason ?? 'unavailable'] ?? '内容未保留'}
              <Show when={body().size}>（{formatBytes(body().size)}）</Show>
            </div>
          </Show>

          {/* JSON 已在内核里做过惰性镜像，直接给树，不必让用户面对一行压缩文本。 */}
          <Show when={body().parsed}>
            {(parsed) => <ValueView value={parsed()} kernel={props.kernel} />}
          </Show>

          <Show when={body().text && !body().parsed}>
            <div class="selectable wrap-anywhere font-mono text-sm leading-5 max-h-80 overflow-y-auto">
              {body().text}
            </div>
          </Show>

          <Show when={body().text}>
            {(text) => (
              <div class="row-center gap-3 mt-2 text-2xs not-selectable">
                <button class="text-accent py-1" onClick={() => props.copier.copy(text()!, props.label)}>
                  复制
                </button>
                <button class="text-fg-tertiary py-1" onClick={() => props.copier.reveal(text()!, props.label)}>
                  查看原文
                </button>
                <span class="text-fg-tertiary">{formatBytes(body().size)}</span>
              </div>
            )}
          </Show>
        </>
      )}
    </Show>
  );
}

/** 分段耗时条：把 DNS/TCP/TLS/等待/下载按比例画出来。 */
function TimingBar(props: { record: NetworkRecord }): JSX.Element {
  const phases = createMemo(() => {
    const { dns, tcp, tls, ttfb, download } = props.record.timing;
    return [
      { label: 'DNS 解析', value: dns, color: '#8e8ef0' },
      { label: 'TCP 连接', value: tcp, color: '#f0a860' },
      { label: 'TLS 握手', value: tls, color: '#f07070' },
      { label: '等待响应', value: ttfb, color: '#60b0f0' },
      { label: '内容下载', value: download, color: '#60c088' },
    ].filter((phase): phase is { label: string; value: number; color: string } => phase.value !== undefined);
  });

  const total = createMemo(() => phases().reduce((sum, phase) => sum + phase.value, 0));

  return (
    <Show
      when={phases().length > 0}
      fallback={
        <div class="text-sm text-fg-tertiary not-selectable">
          无分段数据（跨域资源需服务端返回 Timing-Allow-Origin 才会暴露耗时明细）
        </div>
      }
    >
      <div class="flex h-2 rounded-full overflow-hidden bg-bg-sunken mb-2">
        <For each={phases()}>
          {(phase) => (
            <div
              style={{ width: `${(phase.value / total()) * 100}%`, background: phase.color }}
              title={phase.label}
            />
          )}
        </For>
      </div>
      <For each={phases()}>
        {(phase) => (
          <div class="row-center justify-between text-sm py-0.5">
            <span class="row-center gap-1.5 text-fg-secondary">
              <span class="w-2 h-2 rounded-full shrink-0" style={{ background: phase.color }} />
              {phase.label}
            </span>
            <span class="font-mono">{formatDuration(phase.value)}</span>
          </div>
        )}
      </For>
    </Show>
  );
}

function RequestDetail(props: {
  record: NetworkRecord;
  kernel: OptikKernel;
  copier: CopyController;
  onBack: () => void;
}): JSX.Element {
  const layout = useLayout();
  return (
    <div class="flex flex-col h-full min-h-0">
      <div class="shrink-0 row-center gap-2 px-2 py-1.5 border-b border-line bg-bg-elevated">
        {/* 分栏时列表就在左边，「返回」没有去处，只保留关闭 */}
        <Show
          when={layout.wide()}
          fallback={
            <button class="chip shrink-0" onClick={props.onBack}>
              ‹ 返回
            </button>
          }
        >
          <button class="chip shrink-0 text-fg-tertiary" aria-label="关闭详情" onClick={props.onBack}>
            ✕
          </button>
        </Show>
        <span class="flex-1 min-w-0 truncate text-sm not-selectable">{props.record.name}</span>
        <button
          class="chip shrink-0 text-accent"
          onClick={() => props.copier.copy(toCurl(props.record), 'cURL 命令')}
        >
          cURL
        </button>
        <button
          class="chip shrink-0"
          onClick={() => props.copier.copy(recordToText(props.record), '请求详情')}
        >
          复制
        </button>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto [overscroll-behavior:contain] [-webkit-overflow-scrolling:touch]">
        <Section title="概览">
          <div class="selectable wrap-anywhere font-mono text-sm leading-5">
            <div>
              <span class="text-fg-tertiary">请求地址：</span>
              {props.record.url}
            </div>
            <div>
              <span class="text-fg-tertiary">方法：</span>
              {props.record.method}
              <span class="text-fg-tertiary"> · 类型：</span>
              {INITIATOR_LABELS[props.record.initiator]}
            </div>
            <div>
              <span class="text-fg-tertiary">状态：</span>
              <span class={statusClass(props.record)}>
                {statusText(props.record)} {props.record.statusText}
              </span>
              <Show when={props.record.fromCache}>
                <span class="text-info"> · 来自缓存</span>
              </Show>
            </div>
            <div>
              <span class="text-fg-tertiary">总耗时：</span>
              {formatDuration(props.record.timing.duration)}
            </div>
            <Show when={props.record.error}>
              <div class="text-danger">错误：{props.record.error}</div>
            </Show>
          </div>
        </Section>

        <Show when={props.record.query.length > 0}>
          <Section title="查询参数">
            <KeyValueList items={props.record.query} />
          </Section>
        </Show>

        <Section title="时序">
          <TimingBar record={props.record} />
        </Section>

        <Section title="请求头">
          <KeyValueList items={props.record.requestHeaders} />
        </Section>

        <Show when={props.record.requestBody}>
          <Section title="请求体">
            <BodyView
              body={props.record.requestBody}
              kernel={props.kernel}
              copier={props.copier}
              label="请求体"
            />
          </Section>
        </Show>

        <Section title="响应头">
          <KeyValueList items={props.record.responseHeaders} />
        </Section>

        <Section title="响应体">
          <BodyView
            body={props.record.responseBody}
            kernel={props.kernel}
            copier={props.copier}
            label="响应体"
          />
        </Section>

        <Show when={props.record.frames?.length}>
          <Section title={`帧记录（${props.record.frames!.length}）`}>
            <For each={props.record.frames}>
              {(frame) => (
                <div class="border-b border-line py-1 last:border-0">
                  <div class="row-center gap-1.5 text-2xs text-fg-tertiary not-selectable">
                    <span classList={{ 'text-accent': frame.direction === 'send', 'text-info': frame.direction === 'receive' }}>
                      {frame.direction === 'send' ? '↑ 发送' : '↓ 接收'}
                    </span>
                    <span>{new Date(frame.timestamp).toLocaleTimeString('zh-CN')}</span>
                    <span>{formatBytes(frame.size)}</span>
                  </div>
                  <div class="selectable wrap-anywhere font-mono text-sm leading-5">{frame.payload}</div>
                </div>
              )}
            </For>
          </Section>
        </Show>
      </div>
    </div>
  );
}

/**
 * 列表行。两种形态：
 *  - 紧凑（宽屏 + 鼠标）：单行表格，靠列对齐扫读
 *  - 舒适（手指）：三行卡片，每行不低于 44px，扫读靠留白
 * 密度由指针类型决定而不是宽度——横屏手机有 900+ 的宽度，但依然是手指在点。
 *
 * 行尾常驻一个 cURL 按钮：抓到请求之后最常做的下一步就是搬到电脑上重放，
 * 不该先点进详情再找。它必须是行按钮的**兄弟**而不是子节点——按钮不能嵌套按钮。
 */
function RequestRow(props: {
  record: NetworkRecord;
  selected: boolean;
  /** 详情已打开，左栏变窄，只留名称和状态两列。 */
  narrowColumns: boolean;
  dense: boolean;
  onSelect: () => void;
  onCopyCurl: () => void;
}): JSX.Element {
  /** 行尾操作列的宽度：手指下必须够得着，鼠标下可以收窄给内容让位。 */
  const actionWidth = () => (props.dense ? 'w-10' : 'w-11');

  return (
    <div class="optik-row flex items-stretch" data-selected={props.selected ? 'true' : undefined}>
      <button
        class="flex-1 min-w-0 text-left not-selectable active:bg-bg-sunken"
        classList={{ 'px-2': props.dense, 'px-3 py-2': !props.dense }}
        aria-current={props.selected ? 'true' : undefined}
        onClick={props.onSelect}
      >
        <Show
          when={props.dense}
          fallback={
            <>
              <div class="row-center gap-1.5 text-2xs">
                <span class="px-1 rounded-sm bg-bg-sunken text-fg-secondary shrink-0">
                  {INITIATOR_LABELS[props.record.initiator]}
                </span>
                <span class="font-mono text-fg-secondary shrink-0">{props.record.method}</span>
                <span class={`font-mono shrink-0 ${statusClass(props.record)}`}>
                  {statusText(props.record)}
                </span>
                <Show when={props.record.fromCache}>
                  <span class="text-info shrink-0">缓存</span>
                </Show>
                <span class="flex-1" />
                <span class="text-fg-tertiary shrink-0">
                  {formatDuration(props.record.timing.duration)}
                </span>
              </div>
              <div class="truncate text-base mt-0.5">{props.record.name}</div>
              <div class="truncate text-2xs text-fg-tertiary">{props.record.origin}</div>
            </>
          }
        >
          <div
            class="grid items-center gap-2 font-mono text-xs h-6"
            style={{
              'grid-template-columns': props.narrowColumns
                ? 'minmax(0, 1fr) 44px'
                : 'minmax(0, 1fr) 44px 48px 72px 68px',
            }}
          >
            <span class="truncate">
              {props.record.name}
              <span class="text-fg-tertiary"> {props.record.origin}</span>
            </span>
            <span class={`truncate ${statusClass(props.record)}`}>{statusText(props.record)}</span>
            <Show when={!props.narrowColumns}>
              <span class="truncate text-fg-tertiary">
                {INITIATOR_LABELS[props.record.initiator]}
              </span>
              <span class="truncate text-right text-fg-tertiary">
                {props.record.fromCache ? '缓存' : formatBytes(props.record.responseBody?.size)}
              </span>
              <span class="truncate text-right text-fg-tertiary">
                {formatDuration(props.record.timing.duration)}
              </span>
            </Show>
          </div>
        </Show>
      </button>

      {/*
        WebSocket 不给 cURL：curl 对 ws:// 的支持是实验性的，
        给一条注定跑不通的命令比不给更糟。位置仍然占住，列不会错位。
      */}
      <Show
        when={props.record.initiator !== 'websocket'}
        fallback={<span class={`shrink-0 ${actionWidth()}`} />}
      >
        <button
          class={`shrink-0 ${actionWidth()} row-center justify-center border-l border-line
                  text-2xs text-fg-tertiary not-selectable active:bg-bg-sunken`}
          title="复制为 cURL 命令"
          aria-label={`复制「${props.record.name}」为 cURL 命令`}
          onClick={props.onCopyCurl}
        >
          cURL
        </button>
      </Show>
    </div>
  );
}

export function NetworkPanel(props: {
  store: Store;
  kernel: OptikKernel;
  copier: CopyController;
}): JSX.Element {
  const layout = useLayout();
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [query, setQuery] = createSignal('');
  const [onlyFailed, setOnlyFailed] = createSignal(false);

  const selected = createMemo(() => props.store.requests().find((r) => r.id === selectedId()) ?? null);

  /** 分栏且已选中时左栏很窄，多余的列会把名称挤没，此时收起它们。 */
  const narrowColumns = createMemo(() => layout.wide() && selected() !== null);

  const visible = createMemo(() => {
    const needle = query().toLowerCase();
    return props.store.requests().filter((record) => {
      if (onlyFailed()) {
        const failed = record.phase === 'failed' || (record.status ?? 0) >= 400;
        if (!failed) return false;
      }
      if (needle && !record.url.toLowerCase().includes(needle)) return false;
      return true;
    });
  });

  const list = (
    <div class="flex flex-col h-full min-h-0">
      <div class="shrink-0 border-b border-line bg-bg-elevated">
        <div class="row-center gap-1.5 px-2 py-1.5">
          <input
            class="flex-1 min-w-0 px-2.5 min-h-9 rounded-md bg-bg border border-line text-input selectable"
            type="search"
            inputmode="search"
            placeholder="按地址筛选…"
            autocapitalize="off"
            autocorrect="off"
            spellcheck={false}
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
          <button
            class="chip shrink-0"
            classList={{ 'bg-accent text-accent-fg': onlyFailed() }}
            onClick={() => setOnlyFailed(!onlyFailed())}
          >
            仅失败
          </button>
        </div>
        <div class="row-center gap-2 px-2 pb-1.5 text-2xs not-selectable">
          <span class="text-fg-tertiary">
            {visible().length}/{props.store.requests().length} 条
          </span>
          <button class="chip" onClick={props.store.clearRequests}>
            清空
          </button>
        </div>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto [overscroll-behavior:contain] [-webkit-overflow-scrolling:touch]">
        {/* 表头只在紧凑模式出现：舒适模式的卡片没有列可对齐 */}
        <Show when={layout.dense() && visible().length > 0}>
          <div class="optik-thead flex items-center h-6 text-2xs text-fg-tertiary not-selectable">
            <div
              class="flex-1 min-w-0 grid items-center gap-2 px-2"
              style={{
                'grid-template-columns': narrowColumns()
                  ? 'minmax(0, 1fr) 44px'
                  : 'minmax(0, 1fr) 44px 48px 72px 68px',
              }}
            >
              <span>名称</span>
              <span>状态</span>
              <Show when={!narrowColumns()}>
                <span>类型</span>
                <span class="text-right">大小</span>
                <span class="text-right">耗时</span>
              </Show>
            </div>
            {/* 对齐行尾的 cURL 列，宽度必须和 RequestRow 的 actionWidth 一致 */}
            <span class="shrink-0 w-10 text-center">复制</span>
          </div>
        </Show>

        <Show
          when={visible().length > 0}
          fallback={
            <div class="p-8 text-center text-fg-tertiary text-base not-selectable">
              {props.store.requests().length === 0 ? '暂无请求' : '没有匹配的请求'}
            </div>
          }
        >
          <For each={visible()}>
            {(record) => (
              <RequestRow
                record={record}
                selected={record.id === selectedId()}
                narrowColumns={narrowColumns()}
                dense={layout.dense()}
                onSelect={() => setSelectedId(record.id)}
                onCopyCurl={() => props.copier.copy(toCurl(record), 'cURL 命令')}
              />
            )}
          </For>
        </Show>
      </div>
    </div>
  );

  return (
    <SplitView
      storageKey="optik:split:network"
      placeholder="选中左侧的请求查看详情"
      hasDetail={selected() !== null}
      list={list}
      detail={
        <RequestDetail
          record={selected()!}
          kernel={props.kernel}
          copier={props.copier}
          onBack={() => setSelectedId(null)}
        />
      }
    />
  );
}
