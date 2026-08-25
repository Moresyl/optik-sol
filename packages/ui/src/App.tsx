/**
 * 面板外壳：悬浮按钮、标签栏、可调高度的面板体。
 *
 * 移动端布局的几处硬性约束（踩过才知道）：
 *  - 高度用 `dvh` 而不是 `vh`。iOS 上 `100vh` 把可折叠的地址栏算了进去，
 *    用 `vh` 会让面板底部的操作栏被地址栏永久遮住，怎么都点不到。
 *  - 所有边缘都要加 `env(safe-area-inset-*)`，否则刘海屏和底部横条会吃掉内容。
 *  - 悬浮按钮拖拽结束后要吸附并限制在视口内，转屏之后也要重新夹回来，
 *    否则按钮会跑到屏幕外再也拿不回来。
 */

import { createSignal, createMemo, createEffect, onCleanup, For, Show, type JSX } from 'solid-js';
import type { OptikKernel } from 'optik-core';
import { BUILTIN_TABS, TAB_LABELS, type Store, type TabId } from './store';
import { makeDraggable } from './platform/gesture';
import { createCopyController, Toast, CopySheet } from './components/Copy';
import { ConsolePanel } from './components/ConsolePanel';
import { NetworkPanel } from './components/NetworkPanel';
import { ElementPanel } from './components/ElementPanel';
import { StoragePanel } from './components/StoragePanel';
import { SystemPanel } from './components/SystemPanel';
import { PluginRegistry, safely, type OptikPlugin, type PluginContext } from './plugin';
import { createLayout, LayoutProvider } from './layout';

export type ThemeMode = 'light' | 'dark';

export interface AppProps {
  kernel: OptikKernel;
  store: Store;
  plugins: PluginRegistry;
  host: HTMLElement;
  theme: ThemeMode;
  defaultOpen?: boolean;
  onDispose?: (dispose: () => void) => void;
}

/**
 * 悬浮球尺寸，必须与它 class 上写死的 48px 一致——拖拽夹取靠它算边界，
 * 对不上按钮就会贴不准边。
 *
 * 这个尺寸刻意不参与 uno.config.ts 里的 SCALE 全局缩放：面板内部要紧凑，
 * 是因为你已经进来了；进来之前那一下不该变难点。
 */
const LAUNCHER_SIZE = 48;
const POSITION_KEY = 'optik:launcher-position';
const HEIGHT_KEY = 'optik:panel-height';
const MIN_PANEL_HEIGHT = 0.25;
const MAX_PANEL_HEIGHT = 0.92;
const PANEL_HEIGHT_KEYBOARD_STEP = 0.05;

function readStored(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export interface LauncherPosition {
  x: number;
  y: number;
}

/** 持久化内容属于不可信输入：旧版本、用户脚本或扩展都可能改写它。 */
export function readLauncherPosition(): LauncherPosition {
  const value = readStored(POSITION_KEY);
  if (!value || typeof value !== 'object') return { x: -1, y: -1 };
  const { x, y } = value as Partial<LauncherPosition>;
  return typeof x === 'number' &&
    Number.isFinite(x) &&
    typeof y === 'number' &&
    Number.isFinite(y)
    ? { x, y }
    : { x: -1, y: -1 };
}

export function readPanelHeight(): number {
  const value = readStored(HEIGHT_KEY);
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.6;
  return clampPanelHeight(value);
}

function clampPanelHeight(value: number): number {
  return Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, value));
}

function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 隐私模式下写入会抛 QuotaExceededError，位置记不住而已，不影响使用。
  }
}

export function App(props: AppProps): JSX.Element {
  const [open, setOpen] = createSignal(props.defaultOpen ?? false);
  const [themeMode, setThemeMode] = createSignal<ThemeMode>(props.theme);
  // 量的是面板自身的宽度，不是视口——见 layout.ts 的说明。
  const layout = createLayout();
  const [pluginVersion, setPluginVersion] = createSignal(0);
  const copier = createCopyController();

  // 对外的 show()/hide() 通过宿主元素上的自定义事件驱动，
  // 这样命令式 API 不需要拿到组件内部的 setter。
  const onOpen = () => setOpen(true);
  const onClose = () => setOpen(false);
  props.host.addEventListener('optik:open', onOpen);
  props.host.addEventListener('optik:close', onClose);
  onCleanup(() => {
    props.host.removeEventListener('optik:open', onOpen);
    props.host.removeEventListener('optik:close', onClose);
  });

  // ---- 主题 --------------------------------------------------------------

  /**
   * 只有浅色和深色两档，不跟随系统。
   *
   * 跟随系统在这个场景里是负收益：调试面板经常要和宿主页面对着看，
   * 而宿主页面绝大多数是写死浅色的；系统一到晚上自动切深色，面板就跟着翻脸，
   * 截图发出去还得解释一句「我这边是深色」。默认浅色、手动切换、切了就不动。
   */
  const resolvedTheme = createMemo<'light' | 'dark'>(() => themeMode());

  // 主题落在宿主元素的属性上，CSS 变量与 uno 的 dark: 变体都以它为准。
  createEffect(() => props.host.setAttribute('data-theme', resolvedTheme()));

  // ---- 插件 --------------------------------------------------------------

  const pluginContext: PluginContext = {
    kernel: props.kernel,
    copy: copier.copy,
    reveal: copier.reveal,
    log: (level, ...args) => props.kernel.log.ingest({ level, origin: 'user', args }),
    theme: resolvedTheme,
  };

  const pluginList = createMemo(() => {
    pluginVersion();
    return props.plugins.list();
  });

  const tabs = createMemo(() => [
    ...BUILTIN_TABS.map((id) => ({ id: id as TabId, label: TAB_LABELS[id] })),
    ...pluginList().map((plugin) => ({ id: `plugin:${plugin.id}` as TabId, label: plugin.label })),
  ]);

  const activePluginId = createMemo(() => {
    const tab = props.store.activeTab();
    return tab.startsWith('plugin:') ? tab.slice(7) : null;
  });

  /** 插件视图渲染一次即缓存，切走再切回不会丢状态。 */
  const pluginNodes = new Map<string, Node>();

  const renderPlugin = (id: string): Node | null => {
    const plugin = props.plugins.get(id);
    if (!plugin) return null;
    let node = pluginNodes.get(id);
    if (!node) {
      node = safely('渲染', () => {
        const produced = plugin.render(pluginContext);
        return typeof produced === 'function' ? produced() : produced;
      });
      if (!node) return null;
      pluginNodes.set(id, node);
    }
    return node;
  };

  let shownPlugin: OptikPlugin | undefined;

  const hideShownPlugin = () => {
    if (!shownPlugin) return;
    safely('隐藏', () => shownPlugin?.onHide?.(pluginContext));
    shownPlugin = undefined;
  };

  const disposeRetired = () => {
    for (const plugin of props.plugins.takeRetired()) {
      if (shownPlugin === plugin) hideShownPlugin();
      pluginNodes.delete(plugin.id);
      safely('销毁', () => plugin.onDispose?.(pluginContext));
    }
  };

  const unsubscribePlugins = props.plugins.subscribe(() => {
    disposeRetired();
    setPluginVersion((n) => n + 1);
  });
  // Initial plugin arrays can contain duplicate ids before App subscribes.
  disposeRetired();

  createEffect(() => {
    pluginVersion();
    const id = open() ? activePluginId() : null;
    const next = id ? props.plugins.get(id) : undefined;
    if (next === shownPlugin) return;
    hideShownPlugin();
    if (!next || !renderPlugin(next.id)) return;
    shownPlugin = next;
    safely('显示', () => next.onShow?.(pluginContext));
  });

  onCleanup(() => {
    unsubscribePlugins();
    hideShownPlugin();
    disposeRetired();
    props.plugins.disposeAll(pluginContext);
  });

  // ---- 悬浮按钮 ----------------------------------------------------------

  const initial = readLauncherPosition();
  const [position, setPosition] = createSignal(initial);

  /** 把按钮夹回视口内。转屏、键盘收起、窗口缩放后都要重新夹一次。 */
  const clamp = (x: number, y: number) => {
    const maxX = Math.max(0, innerWidth - LAUNCHER_SIZE - 8);
    const maxY = Math.max(0, innerHeight - LAUNCHER_SIZE - 8);
    return { x: Math.min(Math.max(8, x), maxX), y: Math.min(Math.max(8, y), maxY) };
  };

  const resolvedPosition = createMemo(() => {
    const { x, y } = position();
    // -1 表示"还没被拖过"，默认落在右下角靠上一点的位置。
    if (x < 0 || y < 0) {
      return clamp(innerWidth - LAUNCHER_SIZE - 16, innerHeight - LAUNCHER_SIZE - 96);
    }
    return clamp(x, y);
  });

  const onViewportChange = () => setPosition((previous) => clamp(previous.x, previous.y));
  addEventListener('resize', onViewportChange);
  addEventListener('orientationchange', onViewportChange);
  onCleanup(() => {
    removeEventListener('resize', onViewportChange);
    removeEventListener('orientationchange', onViewportChange);
  });

  /**
   * 拖拽结束后短暂置位，用来吞掉紧随其后的那次 click。
   * 开关面板本身交给原生 click 处理，而不是在 onEnd 里直接 setOpen——
   * 否则键盘回车／空格激活按钮、以及测试里的程序化 click 都不会有反应。
   */
  let suppressClick = false;

  const attachLauncher = (element: HTMLElement) => {
    const dispose = makeDraggable(element, {
      onMove: ({ dx, dy }) => {
        const base = resolvedPosition();
        setPosition(clamp(base.x + dx, base.y + dy));
      },
      onEnd: (_state, wasDrag) => {
        if (!wasDrag) return;
        writeStored(POSITION_KEY, position());
        suppressClick = true;
        // 一次拖拽只吞一次 click；下一帧恢复，避免误伤后续的正常点击。
        requestAnimationFrame(() => {
          suppressClick = false;
        });
      },
    });
    onCleanup(dispose);
  };

  // ---- 面板高度 ----------------------------------------------------------

  const [height, setHeight] = createSignal(readPanelHeight());

  const attachResizer = (element: HTMLElement) => {
    const dispose = makeDraggable(element, {
      threshold: 2,
      onMove: ({ dy }) => {
        // 向上拖是变高，所以取负；上下都留出余量，避免拖成完全不可用的高度。
        setHeight((previous) => clampPanelHeight(previous - dy / innerHeight));
      },
      onEnd: () => writeStored(HEIGHT_KEY, height()),
    });
    onCleanup(dispose);
  };

  const onResizerKeyDown = (event: KeyboardEvent) => {
    let next: number | undefined;
    const step = event.shiftKey ? PANEL_HEIGHT_KEYBOARD_STEP * 2 : PANEL_HEIGHT_KEYBOARD_STEP;
    if (event.key === 'ArrowUp') next = height() + step;
    else if (event.key === 'ArrowDown') next = height() - step;
    else if (event.key === 'Home') next = MIN_PANEL_HEIGHT;
    else if (event.key === 'End') next = MAX_PANEL_HEIGHT;
    if (next === undefined) return;

    event.preventDefault();
    const value = clampPanelHeight(next);
    setHeight(value);
    writeStored(HEIGHT_KEY, value);
  };

  // ---- 渲染 --------------------------------------------------------------

  return (
    <>
      {/*
        悬浮按钮。面板展开时隐藏：它是固定定位的，会压在面板内容和滚动条上，
        而此时标签栏右侧已经有关闭按钮，留着它只剩遮挡。
      */}
      <Show when={!open()}>
        <button
          ref={attachLauncher}
          aria-label="打开调试面板"
          onClick={() => {
            if (suppressClick) return;
            setOpen(true);
          }}
          class="fixed w-[48px] h-[48px] rounded-full row-center justify-center not-selectable
 bg-accent text-accent-fg font-600
 [box-shadow:0_4px_16px_rgba(0,0,0,0.25)] [touch-action:none]"
          style={{
            left: `${resolvedPosition().x}px`,
            top: `${resolvedPosition().y}px`,
            'z-index': 'calc(var(--optik-z) + 1)',
          }}
        >
          <span>Optik</span>
          {/* 错误数角标：面板关着的时候也能第一时间知道出事了。 */}
          <Show when={props.store.errorCount() > 0}>
            {/* 同理，角标要装得下「99+」，尺寸跟着悬浮球一起钉死 */}
            <span
              class="absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 rounded-full row-center justify-center
 bg-danger text-bg"
            >
              {props.store.errorCount() > 99 ? '99+' : props.store.errorCount()}
            </span>
          </Show>
        </button>
      </Show>

      {/* 面板体 */}
      <Show when={open()}>
        <div
          ref={layout.observe}
          inert={copier.sheet() !== null}
          class="fixed left-0 right-0 bottom-0 flex flex-col bg-bg border-t border-line
 rounded-t-xl overflow-hidden [box-shadow:0_-4px_24px_rgba(0,0,0,0.18)]"
          style={{
            // dvh 而非 vh：iOS 的可折叠地址栏会让 vh 算出一个够不着的高度。
            height: `calc(${height()} * 100dvh)`,
            'max-height': 'calc(100dvh - var(--optik-safe-top))',
            'padding-bottom': 'var(--optik-safe-bottom)',
            'padding-left': 'var(--optik-safe-left)',
            'padding-right': 'var(--optik-safe-right)',
            'z-index': 'var(--optik-z)',
          }}
        >
          {/*
            把手和标签栏共用一层 elevated 底色，合成一整块「面板头」，
            和下面白底的内容区分开——原来两者同底色，视觉上是散的。
      */}
          <div
            ref={attachResizer}
            class="shrink-0 row-center justify-center h-5 bg-bg-elevated not-selectable
 [touch-action:none] cursor-ns-resize"
            aria-label="拖动调整面板高度"
            role="separator"
            tabIndex={0}
            aria-orientation="horizontal"
            aria-valuemin={MIN_PANEL_HEIGHT * 100}
            aria-valuemax={MAX_PANEL_HEIGHT * 100}
            aria-valuenow={Math.round(height() * 100)}
            onKeyDown={onResizerKeyDown}
          >
            <div class="w-9 h-1 rounded-full bg-line-strong" />
          </div>

          {/* 标签栏 */}
          <div class="shrink-0 row-center border-b border-line bg-bg-elevated">
            {/* 相对定位是给右侧那道渐变用的：标签能横向滚动时得让人看出来还有 */}
            <div class="relative flex-1 min-w-0">
              <div class="row-center overflow-x-auto no-scrollbar">
                <For each={tabs()}>
                  {(tab) => (
                    <button
                      // -mb-px 让选中态那条 2px 下划线压住容器自己的 1px 边框，
                      // 否则两条线并排，看着像描歪了
                      class="optik-tab shrink-0 row-center gap-1 px-3.5 min-h-11 -mb-px
 not-selectable border-b-2 border-transparent active:bg-bg-sunken"
                      classList={{
                        'text-accent font-600 [border-bottom-color:var(--optik-accent)]':
                          props.store.activeTab() === tab.id,
                        'text-fg-secondary': props.store.activeTab() !== tab.id,
                      }}
                      aria-current={props.store.activeTab() === tab.id ? 'page' : undefined}
                      onClick={() => props.store.setActiveTab(tab.id)}
                    >
                      {tab.label}
                      <Show when={tab.id === 'console' && props.store.errorCount() > 0}>
                        {/*
 text-bg 而不是 text-white：深色主题下的 danger 是浅红，
                          白字压上去几乎看不清，用背景色反而两套主题都成立。
      */}
                        <span class="px-1.5 rounded-full bg-danger text-bg">
                          {props.store.errorCount()}
                        </span>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
              <div class="optik-fade-right" />
            </div>

            <div class="shrink-0 row-center border-l border-line">
              {/*
                「关闭」写成字，不画图标。

                原来这里是一个自己画的叉——用画的而不是 ✕ 字符，是因为那个字形的
                粗细大小全由系统字体决定，在多数安卓机上又细又小。可即便描粗到 2px，
                它仍然是个符号：得先认出来，才知道点下去会发生什么。而这是整个面板里
                唯一一个「点错了就全没了」的按钮，最不该让人猜。

                浅色/深色那颗挪进「环境」之后，这一栏空出了一半，正好够放两个中文字。
                这也是 Shadow DOM 里最后一个 <svg>，去掉之后面板里不再有任何图标。
              */}
              <button
                class="icon-btn min-h-11 px-4 font-600 text-fg"
                aria-label="关闭面板"
                onClick={() => setOpen(false)}
              >
                关闭
              </button>
            </div>
          </div>

          {/* 内容区 */}
          <LayoutProvider value={layout}>
            <div class="flex-1 min-h-0">
              <Show when={props.store.activeTab() === 'console'}>
                <ConsolePanel store={props.store} kernel={props.kernel} copier={copier} />
              </Show>
              <Show when={props.store.activeTab() === 'network'}>
                <NetworkPanel store={props.store} kernel={props.kernel} copier={copier} />
              </Show>
              <Show when={props.store.activeTab() === 'element'}>
                <ElementPanel copier={copier} />
              </Show>
              <Show when={props.store.activeTab() === 'storage'}>
                <StoragePanel kernel={props.kernel} copier={copier} />
              </Show>
              <Show when={props.store.activeTab() === 'system'}>
                <SystemPanel
                  kernel={props.kernel}
                  copier={copier}
                  theme={themeMode()}
                  onThemeChange={setThemeMode}
                />
              </Show>
              <Show when={activePluginId()}>
                {(id) => (
                  <div class="h-full overflow-auto [overscroll-behavior:contain]">
                    {renderPlugin(id()) ?? (
                      <div class="p-8 text-center text-fg-tertiary text-base">插件渲染失败</div>
                    )}
                  </div>
                )}
              </Show>
            </div>
          </LayoutProvider>
        </div>
      </Show>

      <Toast message={copier.toast()} />
      <CopySheet data={copier.sheet()} onClose={copier.closeSheet} />
    </>
  );
}
