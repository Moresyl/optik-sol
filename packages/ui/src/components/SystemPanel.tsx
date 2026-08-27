/**
 * 环境面板：设备、视口、安全区、内存、加载时序、能力探测。
 *
 * 「能力探测」一栏值得单独说明：面板的很多行为会因环境而降级
 * （非 HTTPS 下没有剪贴板接口、隐私模式下没有本地存储、旧 WebView 没有
 * PerformanceObserver）。把这些结论直接摆出来，用户遇到功能不生效时
 * 能立刻知道原因，而不是怀疑工具坏了。
 */

import { createSignal, createMemo, For, Show, onCleanup, type JSX } from 'solid-js';
import type { LongTaskAttribution, OptikKernel } from 'optik-core';
import type { ThemeMode } from '../App';
import { CopyButton, type CopyController } from './Copy';

/**
 * 主题只有两档，就摆成两颗并排的按钮，而不是一个「深色模式」开关。
 *
 * 开关这种控件表达的是「某个特性开着还是关着」；浅色和深色是两种同等的选择，
 * 谁也不是谁的"关闭状态"。写成开关就得挑一个当默认——标签写「深色模式」，
 * 关掉之后是什么？得读的人自己推。两颗按钮把两个选项都写出来，
 * 当前是哪个由高亮说明，没有需要推理的地方。
 */
const THEME_OPTIONS: { id: ThemeMode; label: string }[] = [
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
];

/**
 * 探测项的中文名。键必须与 core 的 `readCapabilities()` 逐字对上——
 * 对不上不会报错，只会安静地把 `cssEnvSafeArea` 这种内部标识符直接显示出来，
 * 既不是中文，也会撑破左侧固定宽度的标签列。
 *
 * 名字统一控制在 9 个中文字符以内，正好在 112px 的标签列里排成一行；
 * 一行放不下就会折成两行，整列的基线立刻参差不齐。
 * WebSocket / IndexedDB 这类保留英文原名：它们是开发者用来搜索的技术标识，
 * 译成中文反而对不上文档。
 */
const CAPABILITY_LABELS: Record<string, string> = {
  secureContext: '安全上下文',
  asyncClipboard: '异步剪贴板',
  execCommandCopy: '同步复制',
  shadowDom: 'Shadow DOM',
  resizeObserver: '尺寸监听',
  performanceObserver: '性能监听',
  resourceTiming: '资源时序',
  longTaskTiming: '长任务时序',
  visualViewport: '可视视口',
  pointerEvents: '指针事件',
  webSocket: 'WebSocket',
  serviceWorker: 'Service Worker',
  indexedDB: 'IndexedDB',
  localStorage: '本地存储',
  dvhUnits: 'dvh 单位',
  cssEnvSafeArea: '安全区变量',
};

/**
 * 同上，键要与 core 的 `readNavigationTiming()` 对齐。
 * 注意 Paint Timing 的条目名来自浏览器本身，是 `first-paint` 这样的短横线形式，
 * 不是驼峰——写成驼峰就永远匹配不上。
 */
const TIMING_LABELS: Record<string, string> = {
  dns: 'DNS 解析',
  tcp: 'TCP 连接',
  ttfb: '首字节',
  response: '响应下载',
  domInteractive: 'DOM 可交互',
  domContentLoaded: 'DOM 就绪',
  load: '页面加载完成',
  'first-paint': '首次绘制',
  'first-contentful-paint': '首次内容绘制',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 一行「标签 + 值」。
 *
 * 标签列宽度写死，是为了让整个面板里所有的值都从同一条竖线开始——
 * 几十行长短不一的标签各自撑开宽度的话，值那一列会像锯齿一样错开。
 * 112px 是按最长的标签（9 个中文字 @12px）量的，改标签文案时要一起看。
 */
function Row(props: { label: string; value: JSX.Element }): JSX.Element {
  return (
    <div class="flex gap-3 px-3 py-1.5 border-b border-line">
      <span class="shrink-0 w-28 leading-5 text-fg-secondary not-selectable">{props.label}</span>
      <span class="flex-1 min-w-0 selectable wrap-anywhere font-mono leading-5">{props.value}</span>
    </div>
  );
}

function Group(props: { title: string; children: JSX.Element }): JSX.Element {
  return (
    <>
      <div class="px-3 py-1.5 bg-bg-elevated font-600 text-fg-secondary not-selectable border-b border-line">
        {props.title}
      </div>
      {props.children}
    </>
  );
}

export function SystemPanel(props: {
  kernel: OptikKernel;
  copier: CopyController;
  theme: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}): JSX.Element {
  const [version, setVersion] = createSignal(0);
  const [longTasks, setLongTasks] = createSignal(props.kernel.performance.longTasks());

  // 视口和内存会随旋转、键盘弹出、GC 而变化，定时重读一次。
  const timer = setInterval(() => setVersion((n) => n + 1), 2000);
  const refreshLongTasks = () => setLongTasks(props.kernel.performance.longTasks());
  const offLongTask = props.kernel.events.on('longTaskAdded', refreshLongTasks);
  const offLongTasksCleared = props.kernel.events.on('longTasksCleared', refreshLongTasks);
  const offLongTasksResized = props.kernel.events.on('longTasksResized', refreshLongTasks);
  onCleanup(() => {
    clearInterval(timer);
    offLongTask();
    offLongTasksCleared();
    offLongTasksResized();
  });

  const info = createMemo(() => {
    version();
    return props.kernel.system.info();
  });

  const timings = createMemo(() =>
    Object.entries(info().timing)
      .filter(([, value]) => Number.isFinite(value) && value >= 0)
      .map(
        ([key, value]) =>
          [TIMING_LABELS[key] ?? key, `${Math.round(value)} ms`] as [string, string],
      ),
  );

  const capabilities = createMemo(() =>
    Object.entries(info().capabilities).map(
      ([key, value]) => [CAPABILITY_LABELS[key] ?? key, value] as [string, boolean],
    ),
  );

  const longTaskSummary = createMemo(() => {
    const tasks = longTasks();
    let total = 0;
    let longest = 0;
    for (const task of tasks) {
      total += task.duration;
      longest = Math.max(longest, task.duration);
    }
    return { count: tasks.length, total, longest };
  });

  const recentLongTasks = createMemo(() => longTasks().slice(-10).reverse());

  const exportAllText = () => {
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
      '--- 主线程长任务 ---',
      `次数：${longTaskSummary().count}`,
      `累计耗时：${Math.round(longTaskSummary().total)} ms`,
      `最长耗时：${Math.round(longTaskSummary().longest)} ms`,
      ...longTasks().map(
        (task) =>
          `+${Math.round(task.startTime)} ms：${Math.round(task.duration)} ms · ${describeLongTask(task.name, task.attribution[0])}`,
      ),
      '',
      '--- 能力探测 ---',
      ...capabilities().map(([label, value]) => `${label}：${value ? '支持' : '不支持'}`),
    ];
    return lines.join('\n');
  };

  return (
    <div class="flex flex-col h-full min-h-0">
      <div class="shrink-0 row-center gap-2 px-2 py-1.5 border-b border-line bg-bg-elevated not-selectable">
        <button class="chip" onClick={() => setVersion((n) => n + 1)}>
          刷新
        </button>
        {/*
          写「复制」不写「导出」。点下去发生的事就是把环境信息写进剪贴板，
          「导出」会让人以为要存文件或者拉个分享面板出来——
          用户点了「导出」、屏幕上飘出「已复制」，是这个面板里最刺眼的一处不一致。
        */}
        <CopyButton
          copier={props.copier}
          text={exportAllText}
          label="环境信息"
          class="min-h-8 px-2 text-accent"
        />
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto [overscroll-behavior:contain] [-webkit-overflow-scrolling:touch]">
        {/*
          设置排在最前，虽然这个面板剩下的部分全是只读信息。

          主题原来常驻在标签栏右上角。那是整个面板里最贵的一块地——横向就那么宽，
          放不下几个东西——而主题是装好之后基本不再动的选项，一天点一次都算多。
          常驻位置留给随时要用的（关闭），低频设置收进这里，需要时找得到就够了。
        */}
        <Group title="设置">
          <div class="row-center gap-3 px-3 py-1.5 border-b border-line">
            <span class="shrink-0 w-28 leading-5 text-fg-secondary not-selectable">外观</span>
            <div class="flex-1 min-w-0 row-center gap-1">
              <For each={THEME_OPTIONS}>
                {(option) => (
                  <button
                    class="chip"
                    classList={{ 'bg-accent text-accent-fg': props.theme === option.id }}
                    aria-pressed={props.theme === option.id}
                    onClick={() => props.onThemeChange(option.id)}
                  >
                    {option.label}
                  </button>
                )}
              </For>
            </div>
          </div>
        </Group>

        <Group title="设备">
          <Row label="客户端" value={info().client} />
          <Row label="平台" value={info().platform} />
          <Row label="语言" value={info().language} />
          <Row
            label="User-Agent"
            value={
              <>
                {info().userAgent}
                <CopyButton
                  copier={props.copier}
                  text={() => info().userAgent}
                  label="User-Agent"
                  class="mt-1 min-h-9 px-2 -ml-2 text-accent"
                />
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
                <CopyButton
                  copier={props.copier}
                  text={() => location.href}
                  label="页面地址"
                  class="mt-1 min-h-9 px-2 -ml-2 text-accent"
                />
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
              <Row
                label="下行带宽"
                value={network().downlink !== undefined ? `${network().downlink} Mbps` : '未知'}
              />
              <Row
                label="往返延迟"
                value={network().rtt !== undefined ? `${network().rtt} ms` : '未知'}
              />
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

        <Group title="主线程长任务">
          <Show
            when={info().capabilities['longTaskTiming']}
            fallback={<Row label="状态" value={<span class="text-warn">当前浏览器不支持</span>} />}
          >
            <Row
              label="统计"
              value={`${longTaskSummary().count} 次 · 累计 ${Math.round(longTaskSummary().total)} ms · 最长 ${Math.round(longTaskSummary().longest)} ms`}
            />
            <Show when={longTasks().length > 0}>
              <Row
                label="操作"
                value={
                  <button class="chip text-danger" onClick={() => props.kernel.performance.clear()}>
                    清空记录
                  </button>
                }
              />
              <For each={recentLongTasks()}>
                {(task) => (
                  <Row
                    label={`+${Math.round(task.startTime)} ms`}
                    value={`${Math.round(task.duration)} ms · ${describeLongTask(task.name, task.attribution[0])}`}
                  />
                )}
              </For>
            </Show>
          </Show>
        </Group>

        <Group title="能力探测">
          <For each={capabilities()}>
            {([label, supported]) => (
              <Row
                label={label}
                value={
                  <span class={supported ? 'text-info' : 'text-warn'}>
                    {supported ? '支持' : '不支持'}
                  </span>
                }
              />
            )}
          </For>
        </Group>
      </div>
    </div>
  );
}

function describeLongTask(name: string, attribution: LongTaskAttribution | undefined): string {
  if (!attribution) return name;
  const container =
    attribution.containerName ||
    attribution.containerId ||
    redactContainerUrl(attribution.containerSrc);
  return container ? `${name} · ${attribution.containerType || 'context'} ${container}` : name;
}

/** Keeps the useful frame location while excluding credentials, query tokens, and fragments. */
function redactContainerUrl(value: string): string {
  if (!value) return '';
  const clean = value.split(/[?#]/, 1)[0] ?? '';
  try {
    const url = new URL(clean);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return clean;
  }
}
