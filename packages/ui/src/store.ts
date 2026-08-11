/**
 * 内核 → Solid 响应式状态的桥接层。
 *
 * 日志是高频写入的：一个 rAF 循环里的 `console.log` 每秒能产生 60+ 条。
 * 这里做两件事来保证 UI 不被写垮：
 *  1. **批量刷新**。内核事件先进暂存队列，由 rAF 统一提交一次，
 *     避免每条日志都触发一次渲染。
 *  2. **不可变引用替换**。Solid 的细粒度更新只需要顶层数组引用变化，
 *     不需要深比较。
 */

import { createSignal, createMemo, createRoot, type Accessor, type Setter } from 'solid-js';
import type { LogEntry, LogLevel, NetworkRecord, OptikKernel } from 'optik-core';

/** 内置标签页；插件标签用 `plugin:<id>` 形式，所以类型上留了字符串口子。 */
export type BuiltinTabId = 'console' | 'network' | 'element' | 'storage' | 'system';
export type TabId = BuiltinTabId | (string & {});

export interface FilterState {
  levels: Set<LogLevel>;
  query: string;
  /** 查询串按正则解析；解析失败则退化为纯文本包含匹配。 */
  useRegex: boolean;
  caseSensitive: boolean;
}

export const ALL_LEVELS: LogLevel[] = ['debug', 'log', 'info', 'warn', 'error'];

export const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: '调试',
  log: '日志',
  info: '信息',
  warn: '警告',
  error: '错误',
};

export const TAB_LABELS: Record<BuiltinTabId, string> = {
  console: '控制台',
  network: '网络',
  element: '元素',
  storage: '存储',
  system: '环境',
};

export const BUILTIN_TABS: BuiltinTabId[] = ['console', 'network', 'element', 'storage', 'system'];

export interface Store {
  logs: Accessor<LogEntry[]>;
  requests: Accessor<NetworkRecord[]>;
  visibleLogs: Accessor<LogEntry[]>;
  errorCount: Accessor<number>;

  activeTab: Accessor<TabId>;
  setActiveTab: Setter<TabId>;

  filter: Accessor<FilterState>;
  setQuery: (query: string) => void;
  toggleLevel: (level: LogLevel) => void;
  setLevels: (levels: LogLevel[]) => void;
  toggleRegex: () => void;

  /** 已勾选待复制的日志 id。 */
  selection: Accessor<Set<string>>;
  toggleSelected: (id: string) => void;
  clearSelection: () => void;
  selectionMode: Accessor<boolean>;
  setSelectionMode: Setter<boolean>;

  clearLogs: () => void;
  clearRequests: () => void;
  dispose: () => void;
}

/**
 * store 在组件树之外创建（mount() 里就要拿到它），所以必须自己开一个反应式根。
 * 否则下面那几个 createMemo 属于"无主计算"——Solid 会警告它们永远不会被销毁，
 * 而且这不只是警告：反复 mount/destroy 时它们会真的泄漏。
 */
export function createStore(kernel: OptikKernel): Store {
  let disposeRoot!: () => void;
  const store = createRoot((dispose) => {
    disposeRoot = dispose;
    return buildStore(kernel);
  });
  return {
    ...store,
    dispose: () => {
      store.dispose();
      disposeRoot();
    },
  };
}

function buildStore(kernel: OptikKernel): Store {
  const [logs, setLogs] = createSignal<LogEntry[]>(kernel.log.entries());
  const [requests, setRequests] = createSignal<NetworkRecord[]>(kernel.network.records());
  const [activeTab, setActiveTab] = createSignal<TabId>('console');
  const [selection, setSelection] = createSignal<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = createSignal(false);

  const [filter, setFilter] = createSignal<FilterState>({
    levels: new Set(ALL_LEVELS),
    query: '',
    useRegex: false,
    caseSensitive: false,
  });

  // ---- 批量刷新 ----------------------------------------------------------

  let logsDirty = false;
  let requestsDirty = false;
  let frame: number | null = null;

  const flush = () => {
    frame = null;
    if (logsDirty) {
      logsDirty = false;
      setLogs(kernel.log.entries());
    }
    if (requestsDirty) {
      requestsDirty = false;
      setRequests(kernel.network.records());
    }
  };

  const schedule = () => {
    if (frame !== null) return;
    // 页面在后台时 rAF 不触发，用 setTimeout 兜底，否则切回前台会看到断层。
    frame =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(flush)
        : (setTimeout(flush, 16) as unknown as number);
  };

  const markLogs = () => {
    logsDirty = true;
    schedule();
  };
  const markRequests = () => {
    requestsDirty = true;
    schedule();
  };

  const unsubscribes = [
    kernel.events.on('logAdded', markLogs),
    kernel.events.on('logUpdated', markLogs),
    kernel.events.on('logCleared', markLogs),
    kernel.events.on('networkStarted', markRequests),
    kernel.events.on('networkUpdated', markRequests),
    kernel.events.on('networkCleared', markRequests),
  ];

  // ---- 过滤 --------------------------------------------------------------

  /**
   * 查询串编译为匹配函数。
   * 正则模式下若语法非法，退化为纯文本匹配而不是抛错清空列表——
   * 用户正在输入 `\d{` 的中间态不应该让整个面板变空。
   */
  const matcher = createMemo(() => {
    const { query, useRegex, caseSensitive } = filter();
    if (!query) return null;

    if (useRegex) {
      try {
        const regex = new RegExp(query, caseSensitive ? 'g' : 'gi');
        return (text: string) => {
          regex.lastIndex = 0;
          return regex.test(text);
        };
      } catch {
        // 落到下面的纯文本分支。
      }
    }

    const needle = caseSensitive ? query : query.toLowerCase();
    return (text: string) => (caseSensitive ? text : text.toLowerCase()).includes(needle);
  });

  const visibleLogs = createMemo(() => {
    const { levels } = filter();
    const match = matcher();
    const all = logs();

    if (levels.size === ALL_LEVELS.length && !match) return all;

    return all.filter((entry) => {
      if (!levels.has(entry.level)) return false;
      if (match && !match(entry.text)) return false;
      return true;
    });
  });

  const errorCount = createMemo(() => logs().filter((entry) => entry.level === 'error').length);

  // ---- 操作 --------------------------------------------------------------

  return {
    logs,
    requests,
    visibleLogs,
    errorCount,
    activeTab,
    setActiveTab,
    filter,

    setQuery(query) {
      setFilter((previous) => ({ ...previous, query }));
    },

    toggleLevel(level) {
      setFilter((previous) => {
        const levels = new Set(previous.levels);
        if (levels.has(level)) levels.delete(level);
        else levels.add(level);
        // 全部取消等于什么都看不到，没有意义；此时恢复全选。
        return { ...previous, levels: levels.size === 0 ? new Set(ALL_LEVELS) : levels };
      });
    },

    setLevels(next) {
      setFilter((previous) => ({ ...previous, levels: new Set(next) }));
    },

    toggleRegex() {
      setFilter((previous) => ({ ...previous, useRegex: !previous.useRegex }));
    },

    selection,

    toggleSelected(id) {
      setSelection((previous) => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },

    clearSelection() {
      setSelection(new Set<string>());
    },

    selectionMode,
    setSelectionMode,

    clearLogs() {
      kernel.log.clear();
      setSelection(new Set<string>());
    },

    clearRequests() {
      kernel.network.clear();
    },

    dispose() {
      for (const off of unsubscribes) off();
      if (frame !== null) {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
        else clearTimeout(frame);
        frame = null;
      }
    },
  };
}
