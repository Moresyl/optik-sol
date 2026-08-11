/**
 * 环境面板：设备、视口、安全区、内存、加载时序、能力探测。
 *
 * 「能力探测」一栏值得单独说明：面板的很多行为会因环境而降级
 * （非 HTTPS 下没有剪贴板接口、隐私模式下没有本地存储、旧 WebView 没有
 * PerformanceObserver）。把这些结论直接摆出来，用户遇到功能不生效时
 * 能立刻知道原因，而不是怀疑工具坏了。
 */

import { createSignal, createMemo, For, Show, onCleanup, type JSX } from 'solid-js';
import type { OptikKernel } from 'optik-core';
import type { CopyController } from './Copy';

const CAPABILITY_LABELS: Record<string, string> = {
  clipboard: '异步剪贴板接口',
  execCommand: 'execCommand 复制',
  secureContext: '安全上下文（HTTPS）',
  serviceWorker: 'Service Worker',
  performanceObserver: 'Performance Observer',
  resourceTiming: 'Resource Timing',
  localStorage: '本地存储',
  sessionStorage: '会话存储',
  indexedDB: 'IndexedDB',
  webSocket: 'WebSocket',
  eventSource: 'EventSource',
  sendBeacon: 'sendBeacon',
  fetch: 'Fetch',
  shadowDom: 'Shadow DOM',
  visualViewport: 'Visual Viewport',
  intersectionObserver: 'Intersection Observer',
  cookieEnabled: 'Cookie 已启用',
};

const TIMING_LABELS: Record<string, string> = {
  dns: 'DNS 解析',
  tcp: 'TCP 连接',
  tls: 'TLS 握手',
  ttfb: '首字节',
  request: '请求',
  response: '响应',
  domInteractive: 'DOM 可交互',
  domContentLoaded: 'DOM 就绪',
  domComplete: 'DOM 完成',
  load: '页面加载完成',
  firstPaint: '首次绘制',
  firstContentfulPaint: '首次内容绘制',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function Row(props: { label: string; value: JSX.Element }): JSX.Element {
  return (
    <div class="flex gap-3 px-3 py-1.5 border-b border-line">
      <span class="shrink-0 w-28 text-sm text-fg-secondary not-selectable">{props.label}</span>
      <span class="flex-1 min-w-0 selectable wrap-anywhere font-mono text-sm">{props.value}</span>
    </div>
  );
}

function Group(props: { title: string; children: JSX.Element }): JSX.Element {
  return (
    <>
      <div class="px-3 py-1.5 bg-bg-elevated text-sm font-600 text-fg-secondary not-selectable border-b border-line">
        {props.title}
      </div>
      {props.children}
    </>
  );
}

export function SystemPanel(props: { kernel: OptikKernel; copier: CopyController }): JSX.Element {
  const [version, setVersion] = createSignal(0);

  // 视口和内存会随旋转、键盘弹出、GC 而变化，定时重读一次。
  const timer = setInterval(() => setVersion((n) => n + 1), 2000);
  onCleanup(() => clearInterval(timer));

  const info = createMemo(() => {
    version();
    return props.kernel.system.info();
  });

  const timings = createMemo(() =>
    Object.entries(info().timing)
      .filter(([, value]) => Number.isFinite(value) && value >= 0)
      .map(([key, value]) => [TIMING_LABELS[key] ?? key, `${Math.round(value)} ms`] as [string, string]),
  );

  const capabilities = createMemo(() =>
    Object.entries(info().capabilities).map(
      ([key, value]) => [CAPABILITY_LABELS[key] ?? key, value] as [string, boolean],
    ),
  );

  const exportAll = () => {
    const data = info();
    const lines = [
      `设备信息 · ${new Date().toLocaleString('zh-CN')}`,
      `页面地址：${location.href}`,
      `User-Agent：${data.userAgent}`,
      `客户端：${data.client}`,
      `平台：${data.platform} · 语言：${data.language}`,
      `视口：${data.viewport.width} × ${data.viewport.height} @${data.viewport.dpr}x`,
      `屏幕：${data.screen.width} × ${data.screen.height}`,
      `安全区：上 ${data.safeArea.top} 右 ${data.safeArea.right} 下 ${data.safeArea.bottom} 左 ${data.safeArea.left}`,
      '',
      '--- 加载时序 ---',
      ...timings().map(([label, value]) => `${label}：${value}`),
      '',
      '--- 能力探测 ---',
      ...capabilities().map(([label, value]) => `${label}：${value ? '支持' : '不支持'}`),
    ];
    props.copier.copy(lines.join('\n'), '环境信息');
  };

  return (
    <div class="flex flex-col h-full min-h-0">
      <div class="shrink-0 row-center gap-2 px-2 py-1.5 border-b border-line bg-bg-elevated text-2xs not-selectable">
        <button class="chip" onClick={() => setVersion((n) => n + 1)}>
          刷新
        </button>
        <button class="chip text-accent" onClick={exportAll}>
          导出全部
        </button>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto [overscroll-behavior:contain] [-webkit-overflow-scrolling:touch]">
        <Group title="设备">
          <Row label="客户端" value={info().client} />
          <Row label="平台" value={info().platform} />
          <Row label="语言" value={info().language} />
          <Row
            label="User-Agent"
            value={
              <>
                {info().userAgent}
                <button
                  class="block mt-1 text-2xs text-accent not-selectable py-1"
                  onClick={() => props.copier.copy(info().userAgent, 'User-Agent')}
                >
                  复制
                </button>
              </>
            }
          />
        </Group>

        <Group title="页面">
          <Row
            label="地址"
            value={
              <>
                {location.href}
                <button
                  class="block mt-1 text-2xs text-accent not-selectable py-1"
                  onClick={() => props.copier.copy(location.href, '页面地址')}
                >
                  复制
                </button>
              </>
            }
          />
          <Row
            label="视口"
            value={`${info().viewport.width} × ${info().viewport.height} @${info().viewport.dpr}x`}
          />
          <Row label="屏幕" value={`${info().screen.width} × ${info().screen.height}`} />
          {/* 安全区是刘海屏适配问题的第一现场，很多"按钮点不到"都由此而来。 */}
          <Row
            label="安全区"
            value={`上 ${info().safeArea.top} · 右 ${info().safeArea.right} · 下 ${info().safeArea.bottom} · 左 ${info().safeArea.left}`}
          />
        </Group>

        <Show when={info().network}>
          {(network) => (
            <Group title="网络">
              <Row label="有效类型" value={network().effectiveType ?? '未知'} />
              <Row label="下行带宽" value={network().downlink !== undefined ? `${network().downlink} Mbps` : '未知'} />
              <Row label="往返延迟" value={network().rtt !== undefined ? `${network().rtt} ms` : '未知'} />
              <Row label="省流模式" value={network().saveData ? '开启' : '关闭'} />
            </Group>
          )}
        </Show>

        <Show when={info().memory}>
          {(memory) => (
            <Group title="内存">
              <Row label="已用堆" value={formatBytes(memory().usedJSHeapSize)} />
              <Row label="堆总量" value={formatBytes(memory().totalJSHeapSize)} />
              <Row label="堆上限" value={formatBytes(memory().jsHeapSizeLimit)} />
            </Group>
          )}
        </Show>

        <Show when={timings().length > 0}>
          <Group title="加载时序">
            <For each={timings()}>{([label, value]) => <Row label={label} value={value} />}</For>
          </Group>
        </Show>

        <Group title="能力探测">
          <For each={capabilities()}>
            {([label, supported]) => (
              <Row
                label={label}
                value={
                  <span class={supported ? 'text-info' : 'text-warn'}>{supported ? '支持' : '不支持'}</span>
                }
              />
            )}
          </For>
        </Group>
      </div>
    </div>
  );
}
