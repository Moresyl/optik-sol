/**
 * 面向使用者的门面包。
 *
 * 同时服务两类接入方式，两者的诉求正好相反：
 *
 * - `<script src>` 直接引：脚本一执行就该开始记录。**日志丢失的窗口期是致命的**——
 *   页面最早期的报错往往正是要排查的那个，等到用户手动调 `mount()` 早就错过了。
 *   所以 IIFE 构建会自动挂载（可用 `data-optik-manual` 属性关掉）。
 *
 * - `import` 引入：不做任何自动行为，由使用者决定何时挂载，
 *   否则 SSR 构建期就会去碰 `document`。
 */

import { mount, instance, type MountOptions, type OptikInstance } from 'optik-ui';

export { mount, instance };
export type { MountOptions, OptikInstance };
export type { OptikPlugin, PluginContext, ThemeMode, TabId } from 'optik-ui';
export {
  OptikKernel,
  ErrorCode,
  ProtocolClient,
  ProtocolRequestError,
  ProtocolRouter,
  attachKernelProtocol,
  copyText,
  createHar,
  createInProcessTransportPair,
  KernelProtocolMethods,
  isError,
  isEvent,
  isRequest,
  isResponse,
  sendEvent,
  serializeHar,
} from 'optik-ui';
export type {
  ErrorResponse,
  KernelProtocolServer,
  LogEntriesResult,
  LongTasksResult,
  NetworkRecordsResult,
  ProtocolError,
  ProtocolEvent,
  ProtocolMessage,
  ProtocolPageParams,
  ProtocolRequest,
  ProtocolRequestOptions,
  ProtocolResponse,
  SuccessResponse,
  Transport,
  HarArchive,
  HarContent,
  HarEntry,
  HarExportOptions,
  HarNameValue,
  HarPostData,
  HarRequest,
  HarResponse,
  HarTimings,
  LongTaskAttribution,
  LongTaskRecord,
  PerformanceDomainEvents,
  PerformanceDomainOptions,
} from 'optik-ui';

/**
 * 读取 script 标签上的配置：
 * `<script src="optik.global.js" data-theme="dark" data-open data-max-logs="2000"></script>`
 */
function readScriptOptions(): MountOptions {
  const script =
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>('script[data-optik]');
  if (!script) return {};

  const options: MountOptions = {};
  const theme = script.dataset['theme'];
  if (theme === 'dark' || theme === 'light') options.theme = theme;
  if (script.dataset['open'] !== undefined) options.defaultOpen = true;

  const maxLogs = Number(script.dataset['maxLogs']);
  if (Number.isFinite(maxLogs) && maxLogs > 0) options.log = { maxEntries: maxLogs };

  const maxRequests = Number(script.dataset['maxRequests']);
  if (Number.isFinite(maxRequests) && maxRequests > 0)
    options.network = { maxRecords: maxRequests };

  const maxLongTasks = Number(script.dataset['maxLongTasks']);
  if (Number.isFinite(maxLongTasks) && maxLongTasks > 0)
    options.performance = { maxLongTasks };

  return options;
}

/** 由 IIFE 构建在加载时调用。ESM 构建不会走到这里。 */
export function autoMount(): void {
  if (typeof document === 'undefined') return;

  const script =
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>('script[data-optik]');
  // 显式关闭自动挂载的逃生舱。
  if (script?.dataset['optikManual'] !== undefined) return;

  const options = readScriptOptions();

  /**
   * 这里刻意**不等 DOMContentLoaded**。脚本放在 `<head>` 时 `document.body`
   * 还不存在，但 `documentElement` 一定存在（解析器读到 `<html>` 就有了）。
   * 先挂到 documentElement 上，插桩随之立即生效——等到 DOM 就绪再挂载，
   * 会白白丢掉页面启动阶段的日志和请求，而那恰恰是最需要看的一段。
   */
  mount({ ...options, container: document.body ?? document.documentElement });
}
