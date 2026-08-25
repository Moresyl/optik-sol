/**
 * 插件系统：向面板注册自定义标签页。
 *
 * 设计上刻意**不要求插件依赖 Solid**。`render` 既可以返回一个真实 DOM 节点
 * （最低门槛，任何人拿 document.createElement 就能写），也可以返回 Solid 组件的
 * JSX。绝大多数业务插件只想塞几个按钮和一段文本，不该被框架绑架。
 *
 * 插件拿到的 `PluginContext` 暴露内核和复制能力——尤其是复制：
 * 插件里展示的内容同样面临 iOS 上复制不出来的问题，让它们各自实现一遍毫无意义。
 */

import type { OptikKernel, LogLevel } from 'optik-core';

export interface PluginContext {
  /** 内核实例：读日志、读网络记录、执行表达式都从这里走。 */
  kernel: OptikKernel;
  /** 复用面板的三级复制策略，非安全上下文下也能保证复制成功。 */
  copy: (text: string, label?: string) => void;
  /** 主动打开「手动复制」弹层，用于展示大段原文。 */
  reveal: (text: string, title?: string) => void;
  /** 往控制台里写一条来源为 `user` 的日志。 */
  log: (level: LogLevel, ...args: unknown[]) => void;
  /** 当前主题，插件可据此调整自绘内容。 */
  theme: () => 'light' | 'dark';
}

export interface OptikPlugin {
  /** 唯一标识，重复注册会覆盖前一个。 */
  id: string;
  /** 标签页显示名（中文）。 */
  label: string;
  /**
   * 渲染标签页内容。返回 DOM 节点或 Solid 组件的返回值皆可。
   * 首次切换到该标签时调用一次，结果会被缓存。
   */
  render: (context: PluginContext) => Node | (() => Node);
  /** 每次切到该标签时调用，适合做数据刷新。 */
  onShow?: (context: PluginContext) => void;
  /** 切走时调用。 */
  onHide?: (context: PluginContext) => void;
  /** 面板销毁时调用，用于解绑插件自己的监听。 */
  onDispose?: (context: PluginContext) => void;
  /** 标签上的角标数字，返回 0 或 undefined 表示不显示。 */
  badge?: () => number | undefined;
}

export class PluginRegistry {
  #plugins = new Map<string, OptikPlugin>();
  #listeners = new Set<() => void>();
  #retired: OptikPlugin[] = [];

  register(plugin: OptikPlugin): void {
    if (!plugin.id || !plugin.label) {
      throw new Error('[optik] 插件必须提供 id 和 label');
    }
    const previous = this.#plugins.get(plugin.id);
    if (previous && previous !== plugin) this.#retired.push(previous);
    this.#plugins.set(plugin.id, plugin);
    this.#notify();
  }

  unregister(id: string): boolean {
    const plugin = this.#plugins.get(id);
    if (!plugin) return false;
    this.#plugins.delete(id);
    this.#retired.push(plugin);
    this.#notify();
    return true;
  }

  get(id: string): OptikPlugin | undefined {
    return this.#plugins.get(id);
  }

  list(): OptikPlugin[] {
    return [...this.#plugins.values()];
  }

  /** 注册表变化时回调，供 UI 重新渲染标签栏。 */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** 被替换/移除的插件仍需由 App 带着完整上下文执行生命周期清理。 */
  takeRetired(): OptikPlugin[] {
    return this.#retired.splice(0);
  }

  disposeAll(context: PluginContext): void {
    const plugins = new Set([...this.#retired, ...this.#plugins.values()]);
    for (const plugin of plugins) {
      try {
        plugin.onDispose?.(context);
      } catch (error) {
        // 插件的清理逻辑出错不能拖垮面板自身的销毁流程。
        console.warn('[optik] 插件销毁失败：', error);
      }
    }
    this.#retired = [];
    this.#plugins.clear();
    this.#listeners.clear();
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}

/** 调用插件方法的统一包装：任何插件异常都不允许冒泡到面板。 */
export function safely<T>(what: string, run: () => T): T | undefined {
  try {
    return run();
  } catch (error) {
    console.warn(`[optik] 插件${what}时出错：`, error);
    return undefined;
  }
}
