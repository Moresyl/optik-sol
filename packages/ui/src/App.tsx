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

import {
  createSignal,
  createMemo,
  createEffect,
  onCleanup,
  For,
  Show,
  type JSX,
} from 'solid-js';
import type { OptikKernel } from 'optik-core';
import { BUILTIN_TABS, TAB_LABELS, type Store, type TabId } from './store';
import { makeDraggable } from './platform/gesture';
import { createCopyController, Toast, CopySheet } from './components/Copy';
import { ConsolePanel } from './components/ConsolePanel';
import { NetworkPanel } from './components/NetworkPanel';
import { ElementPanel } from './components/ElementPanel';
import { StoragePanel } from './components/StoragePanel';
import { SystemPanel } from './components/SystemPanel';
import { PluginRegistry, safely, type PluginContext } from './plugin';
import { createLayout, LayoutProvider } from './layout';

export type ThemeMode = 'light' | 'dark' | 'auto';

export interface AppProps {
  kernel: OptikKernel;
  store: Store;
  plugins: PluginRegistry;
  host: HTMLElement;
  theme: ThemeMode;
  defaultOpen?: boolean;
  onDispose?: (dispose: () => void) => void;
}

const LAUNCHER_SIZE = 48;
const POSITION_KEY = 'optik:launcher-position';
const HEIGHT_KEY = 'optik:panel-height';

/** 读取持久化的数值，任何异常（隐私模式下 localStorage 抛错）都退回默认值。 */
function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
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

  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  const [systemDark, setSystemDark] = createSignal(media?.matches ?? false);
  if (media) {
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener('change', onChange);
    onCleanup(() => media.removeEventListener('change', onChange));
  }

  const resolvedTheme = createMemo<'light' | 'dark'>(() =>
    themeMode() === 'auto' ? (systemDark() ? 'dark' : 'light') : (themeMode() as 'light' | 'dark'),
  );

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

  onCleanup(props.plugins.subscribe(() => setPluginVersion((n) => n + 1)));

  const pluginList = createMemo(() => {
    pluginVersion();
    return props.plugins.list();
  });

  const tabs = createMemo(() => [
    ...BUILTIN_TABS.map((id) => ({ id: id as TabId, label: TAB_LABELS[id] })),
    ...pluginList().map((plugin) => ({ id: `plugin:${plugin.id}` as TabId, label: plugin.label })),
  ]);

  /** 插件视图渲染一次即缓存，切走再切回不会丢状态。 */
  const pluginNodes = new Map<string, Node>();

  const renderPlugin = (id: string): Node | null => {
    const plugin = props.plugins.get(id);
    if (!plugin) return null;
    let node = pluginNodes.get(id);
    if (!node) {
      const produced = safely('渲染', () => plugin.render(pluginContext));
      if (!produced) return null;
      node = typeof produced === 'function' ? produced() : produced;
      pluginNodes.set(id, node);
    }
    safely('显示', () => plugin.onShow?.(pluginContext));
    return node;
  };

  onCleanup(() => props.plugins.disposeAll(pluginContext));

  // ---- 悬浮按钮 ----------------------------------------------------------

  const initial = readStored(POSITION_KEY, { x: -1, y: -1 });
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

  const [height, setHeight] = createSignal(readStored(HEIGHT_KEY, 0.6));

  const attachResizer = (element: HTMLElement) => {
    const dispose = makeDraggable(element, {
      threshold: 2,
      onMove: ({ dy }) => {
        // 向上拖是变高，所以取负；上下都留出余量，避免拖成完全不可用的高度。
        setHeight((previous) => Math.min(0.92, Math.max(0.25, previous - dy / innerHeight)));
      },
      onEnd: () => writeStored(HEIGHT_KEY, height()),
    });
    onCleanup(dispose);
  };

  // ---- 渲染 --------------------------------------------------------------

  const activePluginId = createMemo(() => {
    const tab = props.store.activeTab();
    return tab.startsWith('plugin:') ? tab.slice(7) : null;
  });

  const cycleTheme = () => {
    const order: ThemeMode[] = ['auto', 'light', 'dark'];
    setThemeMode(order[(order.indexOf(themeMode()) + 1) % order.length]);
  };

  // 标签栏在 390px 上本来就挤，主题按钮只能占一到两个字；完整说法放 title。
  const THEME_LABELS: Record<ThemeMode, string> = { auto: '自动', light: '浅色', dark: '深色' };
  const THEME_TITLES: Record<ThemeMode, string> = {
    auto: '当前：跟随系统，点击切换到浅色',
    light: '当前：浅色，点击切换到深色',
    dark: '当前：深色，点击切换到跟随系统',
  };

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
          class="fixed w-12 h-12 rounded-full row-center justify-center not-selectable
                 bg-accent text-accent-fg text-2xs font-600
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
            <span class="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full row-center justify-center
                         bg-danger text-white text-2xs">
              {props.store.errorCount() > 99 ? '99+' : props.store.errorCount()}
            </span>
          </Show>
        </button>
      </Show>

      {/* 面板体 */}
      <Show when={open()}>
        <div
          ref={layout.observe}
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
          {/* 拖拽把手 */}
          <div
            ref={attachResizer}
            class="shrink-0 row-center justify-center h-6 not-selectable [touch-action:none] cursor-ns-resize"
            aria-label="拖动调整面板高度"
          >
            <div class="w-9 h-1 rounded-full bg-line-strong" />
          </div>

          {/* 标签栏 */}
          <div class="shrink-0 row-center border-b border-line">
            <div class="flex-1 min-w-0 row-center overflow-x-auto no-scrollbar">
              <For each={tabs()}>
                {(tab) => (
                  <button
                    class="shrink-0 px-3.5 min-h-11 text-md not-selectable border-b-2 border-transparent"
                    classList={{
                      'text-accent [border-bottom-color:var(--optik-accent)]':
                        props.store.activeTab() === tab.id,
                      'text-fg-secondary': props.store.activeTab() !== tab.id,
                    }}
                    onClick={() => props.store.setActiveTab(tab.id)}
                  >
                    {tab.label}
                    <Show when={tab.id === 'console' && props.store.errorCount() > 0}>
                      <span class="ml-1 px-1.5 rounded-full bg-danger text-white text-2xs">
                        {props.store.errorCount()}
                      </span>
                    </Show>
                  </button>
                )}
              </For>
            </div>
            <button
              class="shrink-0 px-2 min-h-11 text-2xs text-fg-tertiary not-selectable
                     border-l border-line"
              onClick={cycleTheme}
              title={THEME_TITLES[themeMode()]}
              aria-label={THEME_TITLES[themeMode()]}
            >
              {THEME_LABELS[themeMode()]}
            </button>
            <button
              class="shrink-0 px-3 min-h-11 min-w-11 text-lg text-fg-tertiary not-selectable"
              aria-label="关闭面板"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
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
                <SystemPanel kernel={props.kernel} copier={copier} />
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
