/**
 * 控制台面板。
 *
 * 手机上调试的真实痛点不是"看不到日志"，而是"看到了拿不出来"。所以这里
 * 有三条独立的复制路径，且都不依赖剪贴板 API 可用：
 *  1. 长按任意一行 → 复制该行（原生长按选中同时保留）
 *  2. 每行行尾常驻的复制列 → 复制该行
 *  3. 勾选模式 → 批量复制勾中的行；没勾就是当前筛选下的全部
 *
 * 复制出去的是**展开后的完整数据**而不是屏幕上那行带省略号的预览，见 deep-text.ts。
 */

import { createSignal, createEffect, For, Show, on, type JSX } from 'solid-js';
import type { LogEntry, LogLevel, OptikKernel, RemoteObject } from 'optik-core';
import { ALL_LEVELS, LEVEL_LABELS, type Store } from '../store';
import { ValueView } from './Value';
import { onLongPress } from '../platform/gesture';
import { remoteObjectToDeepText } from '../deep-text';
import { CopyButton, type CopyController } from './Copy';

/** 等级 → 配色类名。数据驱动，因此这些类名进了 uno 的 safelist。 */
const LEVEL_CLASS: Record<LogLevel, string> = {
  debug: 'text-debug',
  log: '',
  info: 'text-info',
  warn: 'text-warn bg-warn-bg',
  error: 'text-danger bg-danger-bg',
};

const ORIGIN_LABELS: Record<string, string> = {
  exception: '异常',
  unhandledrejection: '未处理拒绝',
  'resource-error': '资源加载失败',
  'csp-violation': 'CSP 违规',
  user: '手动',
};

/**
 * 内置指令。
 *
 * 表达式求值这个功能本身没问题，问题在输入成本：手机软键盘上敲
 * `Object.fromEntries(Object.entries(localStorage))` 要三十多次点击，还极容易打错，
 * 而真机上想看的东西翻来覆去就那么十几样。所以把这些固定下来一键执行，
 * 输入框留给真正需要现写的场合。
 *
 * **破坏性指令收在「清理」一组里，标红，且要点两次。**
 * 原来这里一条都不放，理由是「清空该在存储面板里连着二次确认一起做」。
 * 那个理由只对了一半：存储面板确实能清 localStorage，但清不掉 Cookie、
 * Cache Storage、Service Worker、IndexedDB，更清不掉「所有名字里带 token 的键」——
 * 而后面这几样恰恰是真机上最常做的一件事：把登录态弄干净，重来一遍。
 * 手机上没有 DevTools 的 Application 面板，不给入口的结果不是「更安全」，
 * 是用户改去用别的工具。所以给，但要点两次才生效。
 */
interface Command {
  label: string;
  expression: string;
  /** 一句话说明这条指令到底做了什么。破坏性的那些必须写。 */
  hint?: string;
  /** 需要补参数：不直接执行，填进输入框并把光标停在引号里。 */
  fill?: boolean;
  /** 破坏性：标红，且需要再点一次确认。 */
  danger?: boolean;
}

/**
 * 判定「这是不是一个登录态相关的键」。
 *
 * 只按键名匹配，不看值——值可能是任意格式的 JWT、加密串或 JSON，没有可靠特征；
 * 而键名是开发者自己起的，`token` / `auth` / `session` 这几个词几乎必然出现。
 * 宁可漏掉几个奇怪命名的，也不能误删业务数据：这条正则是在一个「点两次就没了」
 * 的按钮后面跑的，宽进严出会真的删掉用户不想删的东西。
 */
const AUTH_KEY_PATTERN = String.raw`/token|auth|jwt|session|credential|passport|login|refresh|access/i`;

/** 把当前域下的一个 Cookie 干掉。domain 要连带上级域一起试，否则清不掉签发在父域上的。 */
const EXPIRE_COOKIE = `(n)=>{const b='='+';max-age=0;path=/';document.cookie=n+b;document.cookie=n+b+';domain='+location.hostname;document.cookie=n+b+';domain=.'+location.hostname}`;

/** 读出当前所有 Cookie 的名字。 */
const COOKIE_NAMES = `document.cookie.split(';').map((c)=>c.split('=')[0].trim()).filter(Boolean)`;

const COMMAND_GROUPS: { title: string; commands: Command[] }[] = [
  {
    title: '登录态与缓存',
    commands: [
      {
        label: '清除全部 token',
        hint: '删掉两个 Storage 与 Cookie 里名字含 token / auth / session 的键',
        danger: true,
        expression: `(()=>{const hit=${AUTH_KEY_PATTERN},gone=[],kill=${EXPIRE_COOKIE};for(const s of [localStorage,sessionStorage]){for(const k of Object.keys(s)){if(hit.test(k)){s.removeItem(k);gone.push(k)}}}${COOKIE_NAMES}.forEach((n)=>{if(hit.test(n)){kill(n);gone.push(n)}});return gone.length?'已清除 '+gone.length+' 项：'+gone.join('、'):'没有找到 token 类的键'})()`,
      },
      {
        label: '清除全部 Cookie',
        hint: '当前域及其父域下所有可见 Cookie（HttpOnly 的删不掉）',
        danger: true,
        expression: `(()=>{const kill=${EXPIRE_COOKIE},ns=${COOKIE_NAMES};ns.forEach(kill);return ns.length?'已清除 '+ns.length+' 个 Cookie：'+ns.join('、'):'当前没有可见的 Cookie'})()`,
      },
      {
        label: '清空本地存储',
        hint: 'localStorage.clear()，当前域全部键值',
        danger: true,
        expression: `(()=>{const n=localStorage.length;localStorage.clear();return '已清空本地存储（'+n+' 项）'})()`,
      },
      {
        label: '清空会话存储',
        hint: 'sessionStorage.clear()，只影响当前标签页',
        danger: true,
        expression: `(()=>{const n=sessionStorage.length;sessionStorage.clear();return '已清空会话存储（'+n+' 项）'})()`,
      },
      {
        label: '清空离线缓存',
        hint: 'Cache Storage 里全部缓存库，PWA 拿旧资源时用它',
        danger: true,
        expression: `'caches' in self?(caches.keys().then((ks)=>Promise.all(ks.map((k)=>caches.delete(k))).then((r)=>console.log('已清除 '+r.length+' 个离线缓存'))),'正在清除离线缓存…'):'当前环境没有 Cache Storage'`,
      },
      {
        label: '注销 Service Worker',
        hint: '页面一直拿到旧代码时，先注销再强刷',
        danger: true,
        expression: `navigator.serviceWorker?(navigator.serviceWorker.getRegistrations().then((rs)=>Promise.all(rs.map((r)=>r.unregister())).then((r)=>console.log('已注销 '+r.length+' 个 Service Worker'))),'正在注销 Service Worker…'):'当前环境没有 Service Worker'`,
      },
      {
        label: '删除全部 IndexedDB',
        hint: '当前域下所有数据库',
        danger: true,
        expression: `indexedDB.databases?(indexedDB.databases().then((ds)=>{ds.forEach((d)=>d.name&&indexedDB.deleteDatabase(d.name));console.log('已删除 '+ds.length+' 个 IndexedDB 库')}),'正在删除 IndexedDB…'):'当前浏览器不支持枚举数据库，请到存储面板逐个删除'`,
      },
      {
        label: '全部清空并刷新',
        hint: '两个 Storage + Cookie 一起清掉，然后重新加载页面',
        danger: true,
        expression: `(()=>{const kill=${EXPIRE_COOKIE};localStorage.clear();sessionStorage.clear();${COOKIE_NAMES}.forEach(kill);setTimeout(()=>location.reload(),400);return '已清空全部本地数据，正在刷新…'})()`,
      },
    ],
  },
  {
    title: '存储',
    commands: [
      { label: '本地存储全部内容', expression: 'Object.fromEntries(Object.entries(localStorage))' },
      {
        label: '会话存储全部内容',
        expression: 'Object.fromEntries(Object.entries(sessionStorage))',
      },
      { label: 'Cookie 原文', expression: 'document.cookie' },
      {
        label: 'Cookie 逐条列出',
        expression: `Object.fromEntries(document.cookie.split(';').filter(Boolean).map((c)=>{const i=c.indexOf('=');return [c.slice(0,i).trim(),decodeURIComponent(c.slice(i+1))]}))`,
      },
      {
        label: '找出所有 token 类的键',
        hint: '只看不删，先确认「清除全部 token」会动哪些',
        expression: `(()=>{const hit=${AUTH_KEY_PATTERN},out={};for(const [n,s] of [['本地存储',localStorage],['会话存储',sessionStorage]]){const ks=Object.keys(s).filter((k)=>hit.test(k));if(ks.length)out[n]=ks}const cs=${COOKIE_NAMES}.filter((k)=>hit.test(k));if(cs.length)out.Cookie=cs;return Object.keys(out).length?out:'没有找到 token 类的键'})()`,
      },
      {
        label: '各处占用大小',
        expression: `(()=>{const size=(s)=>Object.keys(s).reduce((n,k)=>n+k.length+(s.getItem(k)||'').length,0),kb=(n)=>(n/1024).toFixed(1)+' KB';return{本地存储:kb(size(localStorage)),会话存储:kb(size(sessionStorage)),Cookie:kb(document.cookie.length)}})()`,
      },
      {
        label: '磁盘配额用了多少',
        expression: `navigator.storage?.estimate?(navigator.storage.estimate().then((e)=>console.log('已用 '+(e.usage/1048576).toFixed(1)+' MB / 配额 '+(e.quota/1048576).toFixed(0)+' MB')),'正在读取配额…'):'当前环境不支持配额查询'`,
      },
      { label: '读某个键', expression: "localStorage.getItem('')", fill: true },
      { label: '写某个键', expression: "localStorage.setItem('', '')", fill: true },
      { label: '删某个键', expression: "localStorage.removeItem('')", fill: true, danger: true },
    ],
  },
  {
    title: '页面',
    commands: [
      { label: '当前地址', expression: 'location.href' },
      {
        label: '地址栏参数',
        expression: 'Object.fromEntries(new URLSearchParams(location.search))',
      },
      { label: '页面标题', expression: 'document.title' },
      { label: '来源页面', expression: "document.referrer || '（直接打开）'" },
      { label: '视口与像素比', expression: '`${innerWidth}×${innerHeight} @${devicePixelRatio}x`' },
      { label: '滚动位置', expression: 'scrollY' },
      { label: '回到页面顶部', expression: 'scrollTo(0, 0)' },
      { label: '重新加载', expression: 'location.reload()' },
      {
        label: '绕过缓存强刷',
        hint: '地址后挂一个时间戳参数再跳转',
        expression: `(()=>{const u=new URL(location.href);u.searchParams.set('_t',Date.now());location.replace(u.href);return '正在强制刷新…'})()`,
      },
    ],
  },
  {
    title: '环境',
    commands: [
      { label: 'User-Agent', expression: 'navigator.userAgent' },
      { label: '是否在线', expression: 'navigator.onLine' },
      { label: '语言', expression: 'navigator.language' },
      // connection 只有 Chromium 系有，没有时返回 undefined 比抛错好
      { label: '网络类型', expression: 'navigator.connection?.effectiveType' },
      { label: '安全上下文', expression: 'isSecureContext' },
      { label: '屏幕尺寸', expression: '`${screen.width}×${screen.height} @${devicePixelRatio}x`' },
      { label: '时区', expression: 'Intl.DateTimeFormat().resolvedOptions().timeZone' },
      { label: 'CPU 核数', expression: 'navigator.hardwareConcurrency' },
      { label: '设备内存（GB）', expression: 'navigator.deviceMemory' },
      {
        label: '安全区内边距',
        hint: '刘海屏和底部横条实际吃掉了多少',
        expression: `(()=>{const s=getComputedStyle(document.documentElement);return ['top','right','bottom','left'].reduce((o,d)=>(o[d]=s.getPropertyValue('--safe-'+d)||CSS.supports('top:env(safe-area-inset-'+d+')')?'支持 env()':'不支持',o),{})})()`,
      },
    ],
  },
  {
    title: '性能',
    commands: [
      {
        label: '首屏关键耗时',
        expression:
          "(e=>e&&({DNS:Math.round(e.domainLookupEnd-e.domainLookupStart),TCP:Math.round(e.connectEnd-e.connectStart),TTFB:Math.round(e.responseStart-e.requestStart),DOM:Math.round(e.domContentLoadedEventEnd-e.startTime),加载完成:Math.round(e.loadEventEnd-e.startTime)}))(performance.getEntriesByType('navigation')[0])",
      },
      { label: '内存占用（仅 Chromium）', expression: 'performance.memory' },
      { label: '资源请求条数', expression: "performance.getEntriesByType('resource').length" },
      {
        label: '总传输量',
        expression: `(()=>{const rs=performance.getEntriesByType('resource');return{条数:rs.length,传输量:(rs.reduce((n,r)=>n+(r.transferSize||0),0)/1024).toFixed(1)+' KB'}})()`,
      },
      {
        label: '最慢的 10 个资源',
        expression: `performance.getEntriesByType('resource').slice().sort((a,b)=>b.duration-a.duration).slice(0,10).map((e)=>Math.round(e.duration)+' ms  '+e.name.split('/').pop())`,
      },
      {
        label: '首次绘制时间',
        expression: `Object.fromEntries(performance.getEntriesByType('paint').map((e)=>[e.name,Math.round(e.startTime)+' ms']))`,
      },
    ],
  },
  {
    title: '查找',
    commands: [
      { label: '查元素', expression: "document.querySelector('')", fill: true },
      { label: '数元素个数', expression: "document.querySelectorAll('').length", fill: true },
      {
        label: '加载失败的图片',
        expression: `[...document.images].filter((i)=>i.complete&&i.naturalWidth===0).map((i)=>i.currentSrc||i.src)`,
      },
      {
        label: '页面上的脚本地址',
        expression: `[...document.scripts].map((s)=>s.src).filter(Boolean)`,
      },
      {
        label: '所有 meta 标签',
        expression: `Object.fromEntries([...document.querySelectorAll('meta[name],meta[property]')].map((m)=>[m.getAttribute('name')||m.getAttribute('property'),m.content]))`,
      },
    ],
  },
];

/** 把命中的片段包成 <mark>，用于搜索高亮。 */
function highlight(text: string, query: string, useRegex: boolean): JSX.Element {
  if (!query) return text;

  let pattern: RegExp;
  try {
    pattern = new RegExp(useRegex ? query : escapeRegex(query), 'gi');
  } catch {
    // 正则输入到一半（例如 `\d{`）时不该让整行消失，退化为纯文本。
    pattern = new RegExp(escapeRegex(query), 'gi');
  }

  const parts: JSX.Element[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    // 零宽匹配会导致死循环，直接放弃高亮。
    if (match[0].length === 0) return text;
    if (index > last) parts.push(text.slice(last, index));
    parts.push(<mark class="optik-hit">{match[0]}</mark>);
    last = index + match[0].length;
  }
  if (parts.length === 0) return text;
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/** 单条日志导出为纯文本，带时间戳与来源标注。 */
/**
 * 复制出去的正文。
 *
 * 有结构化参数（对象、数组、Map…）的时候逐个完整展开，而不是复制屏幕上那行预览——
 * 那行预览是给眼睛扫的，键取前几个、剩下的用 `…` 收尾，复制走等于什么也没复制。
 *
 * 两种情况仍然走原文：
 * `styledParts` 存在说明这条日志用了 `%c` / `%s` 之类的格式串，参数已经被拼进模板，
 * 再单独展开一遍就跟用户看到的那句话对不上了；没有任何可展开参数时，
 * 预览本身就已经是全文。
 */
function entryBodyText(entry: LogEntry, kernel: OptikKernel): string {
  if (entry.styledParts || entry.args.length === 0) return entry.text;
  if (!entry.args.some((arg: RemoteObject) => arg.objectId !== undefined)) return entry.text;

  const parts = entry.args.map((arg: RemoteObject) => remoteObjectToDeepText(arg, kernel));
  // 展开后的对象是多行的，几个参数再用空格接起来会糊成一团。
  return parts.join(parts.some((part) => part.includes('\n')) ? '\n' : ' ');
}

function entryToText(entry: LogEntry, kernel: OptikKernel): string {
  const origin = ORIGIN_LABELS[entry.origin];
  const prefix = `[${formatTime(entry.timestamp)}] [${LEVEL_LABELS[entry.level]}]${origin ? ` [${origin}]` : ''}`;
  const stack = entry.stackTrace?.length
    ? '\n' +
      entry.stackTrace
        .map(
          (f) => ` at ${f.functionName || '(匿名)'} (${f.url}:${f.lineNumber}:${f.columnNumber})`,
        )
        .join('\n')
    : '';
  return `${prefix} ${entryBodyText(entry, kernel)}${stack}`;
}

function LogRow(props: {
  entry: LogEntry;
  store: Store;
  kernel: OptikKernel;
  copier: CopyController;
}): JSX.Element {
  /** 有可展开参数（对象/数组/函数）时才提供结构化视图。 */
  const hasStructured = () =>
    props.entry.args.some((arg: RemoteObject) => arg.objectId !== undefined);

  /**
   * 自己敲进去的表达式，求值结果直接摊开。
   *
   * 用户主动求了一个值，要的就是这个值本身；再让他多点一次「展开对象」
   * 只是把答案又收回去一次。页面自己打的 console.log 不这样——那些是被动流过来的，
   * 一条条全展开会把列表冲垮，所以只有 `origin: 'user'` 这条线默认展开。
   * （回显那行是纯字符串，没有 objectId，不受影响。）
   */
  const [expanded, setExpanded] = createSignal(props.entry.origin === 'user' && hasStructured());

  /**
   * 长按复制本行。注意这里用的是纯观察型手势——它不 preventDefault，
   * 所以系统原生的"长按选中文字"依然可用，两条路互不干扰。
   */
  const attachLongPress = (element: HTMLElement) => {
    const dispose = onLongPress(element, {
      onLongPress: () => props.copier.copy(entryToText(props.entry, props.kernel), '此行'),
    });
    // Solid 的 ref 回调没有 onCleanup 上下文，挂到元素上由面板卸载时统一清理。
    (element as HTMLElement & { __optikDispose?: () => void }).__optikDispose = dispose;
  };

  const selected = () => props.store.selection().has(props.entry.id);

  return (
    <div
      ref={attachLongPress}
      class={`flex items-stretch border-b border-line ${LEVEL_CLASS[props.entry.level]}`}
    >
      <Show when={props.store.selectionMode()}>
        <button
          class="shrink-0 w-6 h-6 mt-1.5 ml-3 rounded border border-line-strong row-center justify-center leading-none not-selectable"
          classList={{ 'bg-accent border-accent text-accent-fg': selected() }}
          aria-label={selected() ? '取消选择' : '选择'}
          onClick={() => props.store.toggleSelected(props.entry.id)}
        >
          {selected() ? '✓' : ''}
        </button>
      </Show>

      <div class="min-w-0 flex-1 px-3 py-1.5">
        <div class="row-center gap-1.5 text-fg-tertiary not-selectable">
          <span>{formatTime(props.entry.timestamp)}</span>
          <Show when={ORIGIN_LABELS[props.entry.origin]}>
            {(label) => <span class="px-1 rounded-sm bg-bg-sunken">{label()}</span>}
          </Show>
          <Show when={props.entry.channel}>
            {(channel) => <span class="px-1 rounded-sm bg-bg-sunken">{channel()}</span>}
          </Show>
          <Show when={props.entry.repeatCount > 1}>
            <span class="px-1.5 rounded-full bg-accent text-accent-fg">
              {props.entry.repeatCount}
            </span>
          </Show>
        </div>

        {/* 折叠视图：一行纯文本，可选中、可搜索高亮。 */}
        <Show when={!expanded()}>
          <div
            class="selectable wrap-anywhere font-mono text-base leading-5"
            style={{ 'padding-left': `${props.entry.groupDepth * 12}px` }}
          >
            <Show
              when={props.entry.styledParts}
              fallback={highlight(
                props.entry.text,
                props.store.filter().query,
                props.store.filter().useRegex,
              )}
            >
              {(parts) => (
                <For each={parts()}>{(part) => <span style={part.css}>{part.text}</span>}</For>
              )}
            </Show>
          </div>
        </Show>

        {/* 展开视图：每个参数一棵可下钻的对象树。 */}
        <Show when={expanded()}>
          <For each={props.entry.args}>
            {(arg) => (
              <ValueView
                value={arg}
                kernel={props.kernel}
                // 求值结果连树的根一起摊开，中间不再隔一次点击。
                defaultExpanded={props.entry.origin === 'user'}
              />
            )}
          </For>
        </Show>

        <Show when={props.entry.stackTrace?.length}>
          <details class="mt-1">
            <summary class="text-fg-tertiary not-selectable cursor-pointer py-1">
              调用栈（{props.entry.stackTrace!.length} 帧）
            </summary>
            <div class="selectable font-mono text-fg-secondary leading-4 pl-2 wrap-anywhere">
              <For each={props.entry.stackTrace}>
                {(frame) => (
                  <div>
                    at {frame.functionName || '(匿名)'} ({frame.url}:{frame.lineNumber}:
                    {frame.columnNumber})
                  </div>
                )}
              </For>
            </div>
          </details>
        </Show>

        {/* 「复制」已经移到行尾常驻列，这里只剩展开开关，没有可展开参数时整行不占高度 */}
        <Show when={hasStructured()}>
          <div class="row-center gap-3 mt-1 not-selectable">
            <button class="text-accent py-1" onClick={() => setExpanded(!expanded())}>
              {expanded() ? '收起' : '展开对象'}
            </button>
          </div>
        </Show>
      </div>

      {/* 行尾常驻的复制列，样式见 uno.config.ts 的 copy-col，与网络面板共用 */}
      <CopyButton
        copier={props.copier}
        text={() => entryToText(props.entry, props.kernel)}
        label="此行（含时间戳与调用栈）"
        class="copy-col"
      />
    </div>
  );
}

export function ConsolePanel(props: {
  store: Store;
  kernel: OptikKernel;
  copier: CopyController;
}): JSX.Element {
  const [input, setInput] = createSignal('');
  /** -1 代表当前草稿，0 开始依次指向由新到旧的历史。 */
  const [historyCursor, setHistoryCursor] = createSignal(-1);
  const [historyDraft, setHistoryDraft] = createSignal('');
  const [picker, setPicker] = createSignal(false);
  /**
   * 底栏的两种形态，默认「指令」。
   *
   * 默认摆输入框是把桌面控制台照搬过来的想法：那里键盘一直在，光标闪着就等你敲。
   * 手机上不是这样——输入框一得焦，半个屏幕被键盘吃掉，而在触屏上手写
   * `Object.fromEntries(Object.entries(localStorage))` 这种东西没有人愿意做第二次。
   * 真正的用法是从现成的指令里挑一条。所以默认就是指令，输入框收起来，
   * 左边那颗按钮写着「输入框」，需要手敲的时候点它换过去，再点换回来。
   */
  const [mode, setMode] = createSignal<'command' | 'input'>('command');
  let inputRef: HTMLInputElement | undefined;
  const [autoScroll, setAutoScroll] = createSignal(true);
  let scroller: HTMLDivElement | undefined;

  /**
   * 只有当用户本来就贴在底部时才自动滚动。否则用户往回翻看历史时
   * 会被新日志不断拽回底部，这是同类工具最招人烦的行为之一。
   */
  const onScroll = () => {
    if (!scroller) return;
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    setAutoScroll(distance < 40);
  };

  createEffect(
    on(props.store.visibleLogs, () => {
      if (!autoScroll() || !scroller) return;
      requestAnimationFrame(() => {
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
      });
    }),
  );

  const run = (source?: string) => {
    const expression = (source ?? input()).trim();
    if (!expression) return;

    props.store.recordReplCommand(expression);
    setInput('');
    setHistoryDraft('');
    setHistoryCursor(-1);

    // 先把输入本身作为一条日志记下来，回显才有上下文。
    props.kernel.log.ingest({ level: 'log', origin: 'user', args: [`› ${expression}`] });

    /*
      把**原始值**交给 ingest，不是它的描述文字。

      之前这里写的是 `result.value?.description`——一个字符串。于是求值
      `Object.fromEntries(Object.entries(localStorage))` 得到的是一行叫「Object」
      的纯文本：展不开，因为字符串没有 objectId；复制出来还是那五个字母，
      因为那一行本来就只有那五个字母。用户要的那份数据在求值那一刻就被扔掉了。

      ingest 收原始值，会自己建镜像、算预览、留下可下钻的句柄，
      并且在这条日志被环形缓冲挤出去时把句柄一并释放——
      和页面自己打的 console.log(obj) 走的是同一条路，行为也就一致。
    */
    const result = props.kernel.evaluate(expression);
    props.kernel.log.ingest({
      level: result.threw ? 'error' : 'info',
      origin: 'user',
      args: [result.threw ? result.error : result.value],
    });
  };

  /** 切换底栏形态。切到输入框就顺手聚焦——用户点它就是为了打字。 */
  const toggleMode = () => {
    const next = mode() === 'command' ? 'input' : 'command';
    setMode(next);
    if (next === 'input') requestAnimationFrame(() => inputRef?.focus());
  };

  const useCommand = (command: Command) => {
    setPicker(false);
    if (!command.fill) {
      run(command.expression);
      return;
    }
    // 需要补参数的：切到输入框、填进去、聚焦、把光标停在那对空引号中间，接着打字就是了
    setMode('input');
    setInput(command.expression);
    setHistoryDraft(command.expression);
    setHistoryCursor(-1);
    requestAnimationFrame(() => {
      if (!inputRef) return;
      inputRef.focus();
      const quotes = command.expression.indexOf("''");
      const caret = quotes === -1 ? command.expression.length : quotes + 1;
      try {
        inputRef.setSelectionRange(caret, caret);
      } catch {
        // 个别 WebView 在未完成布局时会抛，位置不对不影响输入
      }
    });
  };

  const browseHistory = (direction: 'older' | 'newer') => {
    const entries = props.store.replHistory();
    if (entries.length === 0) return;

    const current = historyCursor();
    if (direction === 'older') {
      if (current === -1) setHistoryDraft(input());
      const next = Math.min(current + 1, entries.length - 1);
      setHistoryCursor(next);
      setInput(entries[next] ?? '');
      return;
    }

    if (current === -1) return;
    const next = current - 1;
    setHistoryCursor(next);
    setInput(next === -1 ? historyDraft() : (entries[next] ?? ''));
  };

  const selectedText = () => {
    const ids = props.store.selection();
    return props.store
      .logs()
      .filter((entry) => ids.has(entry.id))
      .map((entry) => entryToText(entry, props.kernel))
      .join('\n');
  };

  const allText = () =>
    props.store
      .visibleLogs()
      .map((entry) => entryToText(entry, props.kernel))
      .join('\n');

  /** 勾选模式下确实勾中了东西。决定工具条那颗复制按钮复制的是「勾中的」还是「全部」。 */
  const hasSelection = () => props.store.selectionMode() && props.store.selection().size > 0;

  return (
    <div class="relative flex flex-col h-full min-h-0">
      {/*
        工具条。指令层浮起来时这三块（工具条 / 日志列表 / REPL）都要 inert：
        它们被完全盖住，但 Tab 和读屏的滑动浏览仍然会走进去。
        老 WebView 不认 inert，忽略即可——退化成现在的行为，不会更糟。
      */}
      <div class="shrink-0 border-b border-line bg-bg-elevated" inert={picker()}>
        <div class="row-center gap-1 px-2 py-1.5 overflow-x-auto no-scrollbar">
          <For each={ALL_LEVELS}>
            {(level) => (
              <button
                class="chip shrink-0"
                classList={{ 'bg-accent text-accent-fg': props.store.filter().levels.has(level) }}
                onClick={() => props.store.toggleLevel(level)}
              >
                {LEVEL_LABELS[level]}
              </button>
            )}
          </For>
        </div>

        <div class="row-center gap-1.5 px-2 pb-1.5">
          {/* 16px 字号：低于此值 iOS Safari 会在聚焦时强制放大整个页面。 */}
          <input
            class="field flex-1"
            type="search"
            name="optik-console-filter"
            aria-label="搜索日志"
            inputmode="search"
            placeholder="搜索日志…"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck={false}
            value={props.store.filter().query}
            onInput={(event) => props.store.setQuery(event.currentTarget.value)}
          />
          <button
            class="chip shrink-0 font-mono"
            classList={{ 'bg-accent text-accent-fg': props.store.filter().useRegex }}
            title="正则匹配"
            onClick={props.store.toggleRegex}
          >
            .*
          </button>
        </div>

        <div class="row-center gap-2 px-2 pb-1.5 not-selectable overflow-x-auto no-scrollbar">
          <span class="text-fg-tertiary shrink-0">
            {props.store.visibleLogs().length}/{props.store.logs().length} 条
          </span>
          <button
            class="chip shrink-0"
            classList={{ 'bg-accent text-accent-fg': props.store.selectionMode() }}
            onClick={() => {
              props.store.setSelectionMode(!props.store.selectionMode());
              props.store.clearSelection();
            }}
          >
            {props.store.selectionMode() ? '退出勾选' : '勾选'}
          </button>
          {/*
            工具条上永远只有一颗复制按钮，复制什么由勾选态决定：
            勾了就复制勾中的那几条，没勾就复制当前筛选下的全部。

            原来这里是两颗并排的（「选中 3 条」和「全部」）。按钮文案统一成
            「复制」之后，两颗并排就成了两个一模一样的按钮——分不出哪颗是哪颗。
            而它们本来也不需要并排：进了勾选模式，用户要的就是勾中的那些，
            这时候还摆一颗「复制全部」是在问一个没人会答的问题。
            旁边「退出勾选」随时可以退回去。
          */}
          <CopyButton
            copier={props.copier}
            text={hasSelection() ? selectedText : allText}
            label={
              hasSelection()
                ? `勾选的 ${props.store.selection().size} 条日志`
                : `全部 ${props.store.visibleLogs().length} 条日志`
            }
            class={`shrink-0 min-h-8 px-2.5 ${hasSelection() ? 'text-accent' : ''}`}
          />
          <button class="chip shrink-0 text-danger" onClick={props.store.clearLogs}>
            清空
          </button>
        </div>
      </div>

      {/* 日志列表 */}
      <div class="flex-1 min-h-0 relative" inert={picker()}>
        <div
          ref={scroller}
          onScroll={onScroll}
          class="h-full overflow-y-auto [overscroll-behavior:contain]
 [-webkit-overflow-scrolling:touch] [touch-action:pan-y]"
        >
          <Show
            when={props.store.visibleLogs().length > 0}
            fallback={
              <div class="p-8 text-center text-fg-tertiary text-base not-selectable">
                {props.store.logs().length === 0 ? '暂无日志' : '没有匹配的日志'}
              </div>
            }
          >
            <For each={props.store.visibleLogs()}>
              {(entry) => (
                <LogRow
                  entry={entry}
                  store={props.store}
                  kernel={props.kernel}
                  copier={props.copier}
                />
              )}
            </For>
          </Show>
        </div>

        {/*
          往回翻历史时自动跟随会停掉，此时新日志还在进。给一个回到底部的入口，
          而不是像别的工具那样在底部常驻一排「Top / Bottom」白占高度——
          贴着底部的时候这个按钮根本不需要存在。
      */}
        <Show when={!autoScroll() && props.store.visibleLogs().length > 0}>
          <button
            class="absolute right-3 bottom-3 px-3 min-h-9 rounded-full not-selectable
 bg-accent text-accent-fg [box-shadow:0_2px_8px_rgba(0,0,0,0.25)]"
            onClick={() => {
              if (scroller) scroller.scrollTop = scroller.scrollHeight;
              setAutoScroll(true);
            }}
          >
            ↓ 最新
          </button>
        </Show>
      </div>

      {/* REPL */}
      <div
        class="shrink-0 row-center gap-1.5 px-2 py-1.5 border-t border-line bg-bg-elevated"
        inert={picker()}
      >
        {/*
          左边这颗是形态开关，写的永远是「另一边是什么」——
          指令态下写「输入框」，输入态下写「指令」。点它就到那边去。
          它不是用来开指令列表的：指令列表由右边那条整宽的按钮打开，
          那条按钮在指令态下占满剩余宽度，是这一栏里最容易点中的目标。
        */}
        <button class="btn shrink-0 px-2.5" onClick={toggleMode}>
          {mode() === 'command' ? '输入框' : '指令'}
        </button>

        <Show
          when={mode() === 'input'}
          fallback={
            <button
              class="btn flex-1 min-w-0 text-fg-secondary"
              aria-expanded={picker()}
              onClick={() => setPicker(true)}
            >
              点选指令…
            </button>
          }
        >
          <input
            class="field flex-1 font-mono"
            name="optik-console-expression"
            aria-label="控制台表达式"
            placeholder="表达式，回车执行"
            autocapitalize="off"
            autocorrect="off"
            autocomplete="off"
            spellcheck={false}
            value={input()}
            ref={(element) => (inputRef = element)}
            onInput={(event) => {
              const value = event.currentTarget.value;
              setInput(value);
              setHistoryDraft(value);
              setHistoryCursor(-1);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                run();
              } else if (event.key === 'ArrowUp' && props.store.replHistory().length > 0) {
                event.preventDefault();
                browseHistory('older');
              } else if (event.key === 'ArrowDown' && historyCursor() !== -1) {
                event.preventDefault();
                browseHistory('newer');
              }
            }}
          />
          <button class="btn-primary shrink-0" onClick={() => run()}>
            执行
          </button>
        </Show>
      </div>

      <Show when={picker()}>
        <CommandSheet
          history={props.store.replHistory()}
          onClose={() => setPicker(false)}
          onPick={useCommand}
          onPickHistory={(expression) => {
            setPicker(false);
            run(expression);
          }}
        />
      </Show>
    </div>
  );
}

/** 指令选择层。覆盖整个面板：一屏能摆下的条目越多，翻找的成本越低。 */
function CommandSheet(props: {
  history: string[];
  onClose: () => void;
  onPick: (command: Command) => void;
  onPickHistory: (expression: string) => void;
}): JSX.Element {
  /**
   * 破坏性指令的二次确认，存的是待确认那一条的 expression。
   *
   * 不用 `confirm()`：它是页面级的模态框，弹出来会把焦点从 Shadow DOM 里抽走，
   * 文案是浏览器的英文、样式也不归我们管，在一个通篇中文的面板里格格不入。
   * 改成「原地把按钮变成『再点一次确认』」——确认动作就发生在手指刚才点的位置，
   * 手不用动，也不存在误点到另一颗按钮上的可能。
   *
   * 一次只有一条处于待确认状态：点了别的自然把上一条撤下来，
   * 这也是最省事的"取消"方式——不需要额外给一颗取消按钮。
   */
  const [armed, setArmed] = createSignal<string | null>(null);

  const tap = (command: Command) => {
    if (!command.danger) {
      props.onPick(command);
      return;
    }
    if (armed() === command.expression) {
      setArmed(null);
      props.onPick(command);
      return;
    }
    setArmed(command.expression);
  };

  return (
    <div class="absolute inset-0 z-20 flex flex-col bg-bg">
      <div class="shrink-0 row-center gap-2 px-2 py-1.5 border-b border-line bg-bg-elevated">
        <span class="flex-1 min-w-0 not-selectable">内置指令</span>
        <button class="chip shrink-0" onClick={props.onClose}>
          关闭
        </button>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto [overscroll-behavior:contain] [-webkit-overflow-scrolling:touch]">
        {/* 历史排在最前：刚敲过的东西通常还要再敲一遍 */}
        <Show when={props.history.length > 0}>
          <div class="px-3 pt-2 pb-1 text-fg-tertiary not-selectable">最近执行</div>
          <For each={props.history.slice(0, 5)}>
            {(expression) => (
              <button
                class="block w-full text-left px-3 py-2 min-h-11 border-b border-line
 not-selectable active:bg-bg-sunken"
                onClick={() => props.onPickHistory(expression)}
              >
                <span class="block truncate font-mono text-fg-secondary">{expression}</span>
              </button>
            )}
          </For>
        </Show>

        <For each={COMMAND_GROUPS}>
          {(group) => (
            <>
              <div class="px-3 pt-2 pb-1 text-fg-tertiary not-selectable">{group.title}</div>
              <For each={group.commands}>
                {(command) => (
                  <button
                    class="block w-full text-left px-3 py-2 min-h-11 border-b border-line
 not-selectable active:bg-bg-sunken"
                    classList={{ 'bg-danger-bg': armed() === command.expression }}
                    onClick={() => tap(command)}
                  >
                    <span class="row-center gap-1.5">
                      <span
                        class="flex-1 min-w-0 truncate"
                        classList={{ 'text-danger': command.danger }}
                      >
                        {command.label}
                      </span>
                      {/* 需要补参数的标出来，免得点下去发现没反应 */}
                      <Show when={command.fill}>
                        <span class="shrink-0 px-1 rounded-sm bg-bg-sunken text-fg-tertiary">
                          待填
                        </span>
                      </Show>
                      <Show when={armed() === command.expression}>
                        <span class="shrink-0 px-1 rounded-sm bg-danger text-accent-fg">
                          再点一次确认
                        </span>
                      </Show>
                    </span>
                    {/*
                      有说明就写说明，没有才退回去露表达式。
                      「清空本地存储」这种话说的是做什么，不是做完之后会怎样——
                      会退登、会丢草稿，得由说明来讲。剩下那些无害的指令写不出什么说明，
                      露表达式反而更有用：既是精确的定义，也顺手教会了怎么自己写一条。
                    */}
                    <Show
                      when={command.hint}
                      fallback={
                        <span class="block truncate font-mono text-fg-tertiary mt-0.5">
                          {command.expression}
                        </span>
                      }
                    >
                      {(hint) => (
                        <span
                          class="block wrap-anywhere text-fg-tertiary mt-0.5"
                          classList={{ 'text-danger': command.danger }}
                        >
                          {hint()}
                        </span>
                      )}
                    </Show>
                  </button>
                )}
              </For>
            </>
          )}
        </For>
      </div>
    </div>
  );
}
