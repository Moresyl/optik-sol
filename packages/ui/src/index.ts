/**
 * 挂载入口。
 *
 * 整个面板活在一个 Shadow DOM 里，这不是为了赶时髦，而是双向隔离的唯一可靠手段：
 * 宿主页面的 `* { box-sizing }`、`img { max-width }`、CSS 重置、乃至某些 UI 库的
 * 全局 `!important`，都进不来；我们的样式也一个字节都漏不出去。被调试的页面
 * 不应该因为接了调试器而变了样，否则调试本身就成了新的变量。
 */

import { render } from 'solid-js/web';
import { OptikKernel, type KernelOptions } from 'optik-core';
import { App, type ThemeMode } from './App';
import { createStore, type TabId } from './store';
import { BASE_STYLES } from './theme';
import { PluginRegistry, type OptikPlugin } from './plugin';
import unoStyles from './generated/uno.css?inline';

export interface MountOptions extends KernelOptions {
  /** 挂载容器，默认 `document.body`。 */
  container?: HTMLElement;
  /** 主题，默认浅色。不提供跟随系统——宿主页面通常是写死浅色的。 */
  theme?: ThemeMode;
  /** 初始是否展开面板，默认否。 */
  defaultOpen?: boolean;
  /** 初始标签页，默认控制台。 */
  defaultTab?: TabId;
  /** 启动时注册的插件。 */
  plugins?: OptikPlugin[];
}

export interface OptikInstance {
  readonly kernel: OptikKernel;
  /** 注册插件，可在挂载后任意时刻调用。 */
  use: (plugin: OptikPlugin) => OptikInstance;
  /** 注销插件。 */
  eject: (id: string) => boolean;
  /** 切换到指定标签页；插件页用 `plugin:<id>`。 */
  show: (tab?: TabId) => void;
  hide: () => void;
  /** 完全卸载：还原所有被改写的原生方法，移除 DOM，释放对象句柄。 */
  destroy: () => void;
}

let current: OptikInstance | null = null;

export function mount(options: MountOptions = {}): OptikInstance {
  // 重复挂载在热更新场景下很常见，直接复用而不是叠两个面板。
  if (current) return current;

  const {
    container,
    theme = 'light',
    defaultOpen,
    defaultTab,
    plugins = [],
    ...kernelOptions
  } = options;

  const kernel = new OptikKernel(kernelOptions);
  kernel.start();

  const store = createStore(kernel);
  if (defaultTab) store.setActiveTab(defaultTab);

  const registry = new PluginRegistry();
  for (const plugin of plugins) registry.register(plugin);

  const host = document.createElement('div');
  // 这个标记有两个用途：元素面板据此把自己从 DOM 树里过滤掉，
  // 拾取模式也据此判断"点在了面板上"。
  host.setAttribute('data-optik-root', '');
  host.style.cssText = 'position:static;display:contents;';

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = BASE_STYLES + unoStyles;
  shadow.appendChild(style);

  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);

  (container ?? document.body).appendChild(host);

  const disposeApp = render(
    () => App({ kernel, store, plugins: registry, host, theme, defaultOpen }),
    mountPoint,
  );

  const instance: OptikInstance = {
    kernel,

    use(plugin) {
      registry.register(plugin);
      return instance;
    },

    eject(id) {
      return registry.unregister(id);
    },

    show(tab) {
      if (tab) store.setActiveTab(tab);
      // 面板的开合由 App 内部状态控制，通过自定义事件通知，避免把 setter 泄露出去。
      host.dispatchEvent(new CustomEvent('optik:open'));
    },

    hide() {
      host.dispatchEvent(new CustomEvent('optik:close'));
    },

    destroy() {
      disposeApp();
      store.dispose();
      kernel.dispose();
      host.remove();
      current = null;
    },
  };

  current = instance;
  return instance;
}

/** 当前实例，未挂载时为 null。 */
export function instance(): OptikInstance | null {
  return current;
}

export { OptikKernel } from 'optik-core';
export type { MountOptions as OptikOptions };
export type { OptikPlugin, PluginContext } from './plugin';
export type { ThemeMode } from './App';
export type { TabId, BuiltinTabId, Store } from './store';
export { copyText, readSelectionText } from './platform/clipboard';
export type { CopyOutcome } from './platform/clipboard';
