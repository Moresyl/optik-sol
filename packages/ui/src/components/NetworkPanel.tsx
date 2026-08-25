/**
 * 网络面板。
 *
 * 除了常规的请求列表，这里还给出了同类工具普遍没有的三样东西：
 *  - **分段耗时**（DNS / TCP / TLS / 等待 / 下载），来自 Resource Timing
 *  - **WebSocket 帧**逐条记录，收发方向分明
 *  - **复制为 cURL**，把手机上抓到的请求直接搬到电脑上重放
 */

import { createSignal, For, Show, createMemo, type JSX } from 'solid-js';
import {
  serializeHar,
  type NetworkRecord,
  type NetworkBody,
  type OptikKernel,
  type RequestInitiator,
} from 'optik-core';
import type { Store } from '../store';
import { CopyButton, type CopyController } from './Copy';
import { ValueView } from './Value';
import { SplitView } from './SplitView';
import { useLayout } from '../layout';

const INITIATOR_LABELS: Record<RequestInitiator, string> = {
  xhr: 'XHR',
  fetch: 'Fetch',
  beacon: 'Beacon',
  websocket: 'WebSocket',
  eventsource: 'SSE',
  resource: '资源',
};

/**
 * 请求分类。
 *
 * 一个页面几十条请求里，真正在排查的通常只有几条接口，其余全是 JS/CSS/图片。
 * 混在一起的列表等于没有列表——所以分类要同时做两件事：**能一键筛掉**，
 * 以及**每行一眼能认出来**。
 */
export type RequestKind =
  'api' | 'stream' | 'script' | 'style' | 'image' | 'font' | 'media' | 'doc' | 'other';

const KIND_LABELS: Record<RequestKind, string> = {
  api: '接口',
  stream: '实时',
  script: 'JS',
  style: 'CSS',
  image: '图片',
  font: '字体',
  media: '媒体',
  doc: '文档',
  other: '其他',
};

/** 扩展名 → 分类。Resource Timing 拿不到 Content-Type 时的兜底。 */
const EXTENSION_KINDS: Record<string, RequestKind> = {
  js: 'script',
  mjs: 'script',
  cjs: 'script',
  ts: 'script',
  css: 'style',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  svg: 'image',
  ico: 'image',
  bmp: 'image',
  woff: 'font',
  woff2: 'font',
  ttf: 'font',
  otf: 'font',
  eot: 'font',
  mp4: 'media',
  webm: 'media',
  mp3: 'media',
  wav: 'media',
  ogg: 'media',
  m3u8: 'media',
  html: 'doc',
  htm: 'doc',
  json: 'api',
  xml: 'doc',
};

/** `initiatorType`（来自 Resource Timing）→ 分类。比猜扩展名可靠。 */
const INITIATOR_TYPE_KINDS: Record<string, RequestKind> = {
  script: 'script',
  css: 'style',
  link: 'style',
  img: 'image',
  image: 'image',
  video: 'media',
  audio: 'media',
  track: 'media',
  iframe: 'doc',
  frame: 'doc',
  navigation: 'doc',
};

function kindOf(record: NetworkRecord): RequestKind {
  if (record.initiator === 'websocket' || record.initiator === 'eventsource') return 'stream';

  // xhr / fetch / beacon 一律算接口：判据是「谁发起的」而不是「返回了什么」。
  // 用 fetch 拉一张图确实会被算成接口，但那也确实是脚本主动发的请求，
  // 按发起方分类的结果是可预期的，按响应类型分类则会让同一个接口忽此忽彼。
  if (record.initiator !== 'resource') return 'api';

  const byInitiatorType = record.responseType && INITIATOR_TYPE_KINDS[record.responseType];
  if (byInitiatorType) return byInitiatorType;

  const mime = record.responseBody?.mimeType;
  if (mime) {
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('font/') || mime.includes('font')) return 'font';
    if (mime.startsWith('audio/') || mime.startsWith('video/')) return 'media';
    if (mime.includes('javascript') || mime.includes('ecmascript')) return 'script';
    if (mime.includes('css')) return 'style';
    if (mime.includes('json')) return 'api';
    if (mime.includes('html')) return 'doc';
  }

  // 文件名里的扩展名。查询串已经在内核里被切走，这里拿到的是干净的最后一段。
  const dot = record.name.lastIndexOf('.');
  const extension = dot === -1 ? '' : record.name.slice(dot + 1).toLowerCase();
  return EXTENSION_KINDS[extension] ?? 'other';
}

/**
 * 紧凑模式的列宽。行和表头必须共用同一份，否则错开一两像素就再也对不齐。
 * 分类列（36px）在任何宽度下都保留——它是这张表里最先被读的一列。
 */
const NARROW_COLUMNS = '36px minmax(0, 1fr) 44px';
const WIDE_COLUMNS = '36px minmax(0, 1fr) 44px 72px 68px';

/**
 * 筛选条上分类的排列顺序，与 DevTools 的 Fetch/XHR、JS、CSS、Img… 同一套思路：
 * 一档对应一种资源，不做「资源」这种二次归堆——查 JS 的时候不该连图片一起看。
 * 排序按查问题的频率，不按字母。
 */
const FILTER_ORDER: RequestKind[] = [
  'api',
  'script',
  'style',
  'image',
  'media',
  'font',
  'doc',
  'stream',
  'other',
];

/** 分类徽章。颜色由 CSS 的 data-kind 驱动——类名是数据拼的，Uno 的静态扫描看不见。 */
function KindBadge(props: { kind: RequestKind }): JSX.Element {
  return (
    <span class="optik-kind not-selectable" data-kind={props.kind}>
      {KIND_LABELS[props.kind]}
    </span>
  );
}

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
  lines.push(
    '',
    '--- 响应头 ---',
    ...record.responseHeaders.map(([name, value]) => `${name}: ${value}`),
  );
  if (record.responseBody?.text) lines.push('', '--- 响应体 ---', record.responseBody.text);
  if (record.error) lines.push('', `错误：${record.error}`);
  return lines.join('\n');
}

function Section(props: {
  title: string;
  children: JSX.Element;
  action?: JSX.Element;
}): JSX.Element {
  return (
    <div class="border-b border-line">
      <div class="row-center justify-between px-3 py-2 bg-bg-elevated not-selectable">
        <span class="font-600 text-fg-secondary">{props.title}</span>
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
      fallback={<div class="text-fg-tertiary not-selectable">（无）</div>}
    >
      <For each={props.items}>
        {([name, value]) => (
          <div class="selectable wrap-anywhere font-mono leading-5 py-0.5">
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
    <Show when={props.body} fallback={<div class="text-fg-tertiary not-selectable">（无）</div>}>
      {(body) => (
        <>
          <Show when={body().omitted}>
            <div class="text-warn not-selectable">
              {OMITTED_REASONS[body().omittedReason ?? 'unavailable'] ?? '内容未保留'}
              <Show when={body().size}>（{formatBytes(body().size)}）</Show>
            </div>
          </Show>

          {/*
            JSON 已在内核里做过惰性镜像，直接给树，不必让用户面对一行压缩文本。
            domain 必须显式给网络域：这些 objectId 是网络域的注册表发的，
            用默认的日志域去解会解到编号相同的另一个对象上。
          */}
          <Show when={body().parsed}>
            {(parsed) => (
              <ValueView value={parsed()} kernel={props.kernel} domain={props.kernel.network} />
            )}
          </Show>

          <Show when={body().text && !body().parsed}>
            <div class="selectable wrap-anywhere font-mono leading-5 max-h-80 overflow-y-auto">
              {body().text}
            </div>
          </Show>

          <Show when={body().text}>
            {(text) => (
              <div class="row-center gap-1 mt-2 not-selectable">
                <CopyButton
                  copier={props.copier}
                  text={() => text()!}
                  label={props.label}
                  class="min-h-9 px-2 text-accent"
                />
                <button
                  class="icon-btn min-h-9 px-2"
                  onClick={() => props.copier.reveal(text()!, props.label)}
                >
                  查看原文
                </button>
                <span class="flex-1" />
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
    ].filter(
      (phase): phase is { label: string; value: number; color: string } =>
        phase.value !== undefined,
    );
  });

  const total = createMemo(() => phases().reduce((sum, phase) => sum + phase.value, 0));

  return (
    <Show
      when={phases().length > 0}
      fallback={
        <div class="text-fg-tertiary not-selectable">
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
          <div class="row-center justify-between py-0.5">
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
          <button
            class="chip shrink-0 text-fg-tertiary"
            aria-label="关闭详情"
            onClick={props.onBack}
          >
            ✕
          </button>
        </Show>
        <span class="flex-1 min-w-0 truncate not-selectable">{props.record.name}</span>
        {/*
          详情头上只留一颗复制按钮，复制的是整份详情。
          原来这里并排放着「cURL」和「全部」两颗——两颗都是复制，
          却用两个不同的词，还得先读懂哪个是哪个。cURL 挪进了下面
          自己的分区，标题写着「cURL 命令」，按钮就只用说「复制」。
        */}
        <CopyButton
          copier={props.copier}
          text={() => recordToText(props.record)}
          label="请求详情"
          class="min-h-9 px-2"
        />
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto [overscroll-behavior:contain] [-webkit-overflow-scrolling:touch]">
        <Section title="概览">
          <div class="selectable wrap-anywhere font-mono leading-5">
            <div>
              <span class="text-fg-tertiary">请求地址：</span>
              {props.record.url}
            </div>
            <div>
              <span class="text-fg-tertiary">方法：</span>
              {props.record.method}
              <span class="text-fg-tertiary"> · 类型：</span>
              {KIND_LABELS[kindOf(props.record)]}
              <span class="text-fg-tertiary">（{INITIATOR_LABELS[props.record.initiator]}）</span>
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

        {/*
          cURL 单独成一个分区，而不是头上一颗写着「cURL」的按钮。
          按钮的文案统一成「复制」之后，「复制的是什么」这件事得由别处交代——
          分区标题正是干这个的。顺带还多了一样原来没有的东西：
          命令本身摆在眼前，可以先看一眼再决定要不要复制，
          也可以直接长按选中其中一段（比如只要那串 token）。
          WebSocket 不给：curl 对 ws:// 的支持是实验性的，
          给一条注定跑不通的命令比不给更糟。
        */}
        <Show when={props.record.initiator !== 'websocket'}>
          <Section
            title="cURL 命令"
            action={
              <CopyButton
                copier={props.copier}
                text={() => toCurl(props.record)}
                label="cURL 命令"
                class="min-h-8 px-2 text-accent"
              />
            }
          >
            <div class="selectable wrap-anywhere font-mono leading-5 text-fg-secondary">
              {toCurl(props.record)}
            </div>
          </Section>
        </Show>

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
                  <div class="row-center gap-1.5 text-fg-tertiary not-selectable">
                    <span
                      classList={{
                        'text-accent': frame.direction === 'send',
                        'text-info': frame.direction === 'receive',
                      }}
                    >
                      {frame.direction === 'send' ? '↑ 发送' : '↓ 接收'}
                    </span>
                    <span>{new Date(frame.timestamp).toLocaleTimeString('zh-CN')}</span>
                    <span>{formatBytes(frame.size)}</span>
                  </div>
                  <div class="selectable wrap-anywhere font-mono leading-5">{frame.payload}</div>
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
  kind: RequestKind;
  selected: boolean;
  /** 详情已打开，左栏变窄，只留分类、名称和状态三列。 */
  narrowColumns: boolean;
  dense: boolean;
  onSelect: () => void;
  copier: CopyController;
}): JSX.Element {
  // 行尾复制列的样式见 uno.config.ts 的 copy-col，与控制台面板共用同一条。

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
              <div class="row-center gap-1.5">
                <KindBadge kind={props.kind} />
                <span class="font-mono text-fg-secondary shrink-0">{props.record.method}</span>
                <span class={`font-mono shrink-0 ${statusClass(props.record)}`}>
                  {statusText(props.record)}
                </span>
                {/*
                  同样是「接口」，走 XHR 还是 fetch 会影响怎么复现，值得占这几个字。
                  但静态资源就不必了——徽章已经写着 JS/CSS，再补一个「资源」是废话。
      */}
                <Show when={props.kind === 'api' || props.kind === 'stream'}>
                  <span class="text-fg-tertiary shrink-0">
                    {INITIATOR_LABELS[props.record.initiator]}
                  </span>
                </Show>
                <Show when={props.record.fromCache}>
                  <span class="text-info shrink-0">缓存</span>
                </Show>
                <span class="flex-1" />
                <span class="text-fg-tertiary shrink-0">
                  {formatDuration(props.record.timing.duration)}
                </span>
              </div>
              <div class="truncate text-base mt-0.5">{props.record.name}</div>
              <div class="truncate text-fg-tertiary">{props.record.origin}</div>
            </>
          }
        >
          <div
            class="grid items-center gap-2 font-mono h-6"
            style={{ 'grid-template-columns': props.narrowColumns ? NARROW_COLUMNS : WIDE_COLUMNS }}
          >
            {/* 分类列打头且永不折叠：列表最先要回答的问题是「这条是不是接口」。 */}
            <KindBadge kind={props.kind} />
            <span class="truncate">
              {props.record.name}
              <span class="text-fg-tertiary"> {props.record.origin}</span>
            </span>
            <span class={`truncate ${statusClass(props.record)}`}>{statusText(props.record)}</span>
            <Show when={!props.narrowColumns}>
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
        行尾常驻的复制列，复制的是整条请求的详情——和控制台里那一列
        复制整条日志是同一个意思，位置、宽度、贴顶方式也都来自同一条 copy-col。
        （只想要 cURL 的话在详情里，那里单独有一个分区。）
      */}
      <CopyButton
        copier={props.copier}
        text={() => recordToText(props.record)}
        label={`请求「${props.record.name}」`}
        class="copy-col"
      />
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
  /** null 表示「全部」。 */
  const [kindFilter, setKindFilter] = createSignal<RequestKind | null>(null);

  const selected = createMemo(
    () => props.store.requests().find((r) => r.id === selectedId()) ?? null,
  );

  /** 分栏且已选中时左栏很窄，多余的列会把名称挤没，此时收起它们。 */
  const narrowColumns = createMemo(() => layout.wide() && selected() !== null);

  /** 分类只算一次，行、筛选、计数三处共用。 */
  const classified = createMemo(() =>
    props.store.requests().map((record) => ({ record, kind: kindOf(record) })),
  );

  /** 每一档的条数。 */
  const counts = createMemo(() => {
    const result = {} as Record<RequestKind, number>;
    for (const { kind } of classified()) result[kind] = (result[kind] ?? 0) + 1;
    return result;
  });

  const visible = createMemo(() => {
    const needle = query().toLowerCase();
    const filter = kindFilter();
    return classified().filter(({ record, kind }) => {
      if (filter !== null && kind !== filter) return false;
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
            class="field flex-1"
            type="search"
            name="optik-network-filter"
            aria-label="按地址筛选网络请求"
            inputmode="search"
            placeholder="按地址筛选…"
            autocomplete="off"
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
        {/*
          分类筛选。一个页面几十条请求里真正在查的往往只有几条接口，
          「接口」这一档是这个面板被打开时最常按的按钮，所以它排第一、
          在第一屏、不藏进任何菜单里。再点一次回到全部，省掉一次来回。

          九档全部常驻、横向滑动，不再按「有没有抓到」增删：
          档位随请求陆续插进来的话，整条筛选条会在手指底下自己变长，
          刚瞄准的那个 chip 就跑掉了。位置固定比少滑两下值钱。
          空档保留可点——点进去看到「没有匹配的请求」，本身就是个明确的答案。
      */}
        <div class="row-center gap-1 px-2 pb-1.5">
          <div class="relative flex-1 min-w-0">
            <div class="row-center gap-1 overflow-x-auto no-scrollbar">
              <button
                class="chip shrink-0 gap-1"
                classList={{ 'bg-accent text-accent-fg': kindFilter() === null }}
                aria-pressed={kindFilter() === null}
                onClick={() => setKindFilter(null)}
              >
                全部
                <span classList={{ 'text-fg-tertiary': kindFilter() !== null }}>
                  {classified().length}
                </span>
              </button>
              <For each={FILTER_ORDER}>
                {(kind) => (
                  <button
                    class="chip shrink-0 gap-1"
                    classList={{
                      'bg-accent text-accent-fg': kindFilter() === kind,
                      // 没抓到过的档位压暗，一眼能看出这一屏的流量都落在哪几档
                      'text-fg-tertiary': kindFilter() !== kind && !counts()[kind],
                    }}
                    aria-pressed={kindFilter() === kind}
                    onClick={() => setKindFilter(kindFilter() === kind ? null : kind)}
                  >
                    {KIND_LABELS[kind]}
                    <span classList={{ 'text-fg-tertiary': kindFilter() !== kind }}>
                      {counts()[kind] ?? 0}
                    </span>
                  </button>
                )}
              </For>
            </div>
            {/* 横向滚动条是隐藏的，没有这道渐变看不出右边还有档位 */}
            <div class="optik-fade-right" />
          </div>
          {/* 「清空」留在滚动区外：它要是跟着滑走，想清空得先滑到头 */}
          <button class="chip shrink-0" onClick={props.store.clearRequests}>
            清空
          </button>
          <div class="shrink-0 row-center gap-1 text-fg-tertiary" title="默认脱敏后复制 HAR 1.2">
            <span>HAR</span>
            <CopyButton
              copier={props.copier}
              text={() => serializeHar(props.store.requests())}
              label="全部请求 HAR（安全模式：无正文）"
              class="min-h-8 px-2"
            />
          </div>
        </div>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto [overscroll-behavior:contain] [-webkit-overflow-scrolling:touch]">
        {/* 表头只在紧凑模式出现：舒适模式的卡片没有列可对齐 */}
        <Show when={layout.dense() && visible().length > 0}>
          <div class="optik-thead flex items-center h-6 text-fg-tertiary not-selectable">
            <div
              class="flex-1 min-w-0 grid items-center gap-2 px-2"
              style={{ 'grid-template-columns': narrowColumns() ? NARROW_COLUMNS : WIDE_COLUMNS }}
            >
              <span>类型</span>
              <span>名称</span>
              <span>状态</span>
              <Show when={!narrowColumns()}>
                <span class="text-right">大小</span>
                <span class="text-right">耗时</span>
              </Show>
            </div>
            {/* 对齐行尾的复制列，宽度必须和 copy-col 一致 */}
            <span class="shrink-0 w-12 text-center">复制</span>
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
            {({ record, kind }) => (
              <RequestRow
                record={record}
                kind={kind}
                selected={record.id === selectedId()}
                narrowColumns={narrowColumns()}
                dense={layout.dense()}
                onSelect={() => setSelectedId(record.id)}
                copier={props.copier}
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
