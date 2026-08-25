/**
 * 基础层样式：设计令牌、Shadow DOM reset、以及原子类表达不了的少数规则。
 *
 * 组件的排版一律用 UnoCSS 原子类（见 uno.config.ts），这里只保留三类内容：
 *  1. CSS 变量（深浅主题的唯一切换点）
 *  2. Shadow DOM 专用 reset —— Tailwind/Uno 的 preflight 针对 html/body，
 *     而这两个选择器在 Shadow DOM 里匹配不到任何元素，必须自己写
 *  3. 关键帧、滚动条隐藏等原子类覆盖不到的规则
 */

export const BASE_STYLES = /* css */ `
:host {
  --optik-font: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB',
                'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  --optik-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas,
                'Liberation Mono', 'Courier New', monospace;

  --optik-bg: #ffffff;
  --optik-bg-elevated: #f7f7f8;
  --optik-bg-sunken: #eeeef0;
  --optik-border: rgba(0, 0, 0, 0.10);
  --optik-border-strong: rgba(0, 0, 0, 0.20);

  --optik-text: #1c1c1e;
  --optik-text-secondary: #68686e;
  --optik-text-tertiary: #9a9aa0;

  --optik-accent: #0a84ff;
  --optik-accent-contrast: #ffffff;

  --optik-level-warn-text: #8a6100;
  --optik-level-warn-bg: #fff8e1;
  --optik-level-warn-border: #f0c86a;
  --optik-level-error-text: #c02626;
  --optik-level-error-bg: #fff0f0;
  --optik-level-error-border: #f0a0a0;
  --optik-level-debug-text: #7a5cc4;
  --optik-level-info-text: #0a6ed1;

  --optik-token-string: #c41a16;
  --optik-token-number: #1c00cf;
  --optik-token-boolean: #aa0d91;
  --optik-token-null: #7f7f7f;
  --optik-token-key: #881391;
  --optik-token-function: #0b7285;
  --optik-token-tag: #881280;
  --optik-token-attr: #994500;

  --optik-safe-top: env(safe-area-inset-top, 0px);
  --optik-safe-right: env(safe-area-inset-right, 0px);
  --optik-safe-bottom: env(safe-area-inset-bottom, 0px);
  --optik-safe-left: env(safe-area-inset-left, 0px);

  --optik-z: 2147483000;

  /* 宿主页面的继承样式在这里被彻底截断，我们的样式同样出不去 */
  all: initial;
  font-family: var(--optik-font);
  /* 面板唯一的字号，见 uno.config.ts 的 fontSize。
     写在 :host 上是为了让它成为**继承下来的默认值**：
     没写任何字号类的元素自动就是 13px，而不是 all:initial 之后的 medium（16px）。 */
  font-size: 13px;
  line-height: 20px;
  color: var(--optik-text);
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}

:host([data-theme='dark']) {
  --optik-bg: #1c1c1e;
  --optik-bg-elevated: #2c2c2e;
  --optik-bg-sunken: #131315;
  --optik-border: rgba(255, 255, 255, 0.12);
  --optik-border-strong: rgba(255, 255, 255, 0.24);

  --optik-text: #f2f2f7;
  --optik-text-secondary: #a0a0a8;
  --optik-text-tertiary: #6e6e76;

  --optik-accent: #4aa3ff;

  --optik-level-warn-text: #ffd479;
  --optik-level-warn-bg: #38300f;
  --optik-level-warn-border: #6b551d;
  --optik-level-error-text: #ff8a80;
  --optik-level-error-bg: #3a1b1b;
  --optik-level-error-border: #6b2b2b;
  --optik-level-debug-text: #b79cff;
  --optik-level-info-text: #6cb8ff;

  --optik-token-string: #ff7b72;
  --optik-token-number: #79c0ff;
  --optik-token-boolean: #d2a8ff;
  --optik-token-null: #8b949e;
  --optik-token-key: #7ee787;
  --optik-token-function: #56d4dd;
  --optik-token-tag: #7ee787;
  --optik-token-attr: #ffa657;
}

/* Shadow DOM 版 reset */
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  border: 0 solid var(--optik-border);
  -webkit-tap-highlight-color: transparent;
}

/*
   Uno 的 transform 类是靠一组 CSS 变量拼出来的：
   哪怕只写 -translate-x-1/2，生成的也是 translateX(var(--un-translate-x)) … scaleZ(var(--un-scale-z))
   这一长串。只要有一个变量没有初值，整条 transform 就是非法值，会被整体丢弃——
   表现为「类明明生成了却完全不生效」。
   这组初值本该由 preflight 提供，而我们关掉了 preflight，只能自己补。 */
*, *::before, *::after {
  --un-translate-x: 0;
  --un-translate-y: 0;
  --un-translate-z: 0;
  --un-rotate: 0;
  --un-rotate-x: 0;
  --un-rotate-y: 0;
  --un-rotate-z: 0;
  --un-skew-x: 0;
  --un-skew-y: 0;
  --un-scale-x: 1;
  --un-scale-y: 1;
  --un-scale-z: 1;
}

button, input, textarea, select {
  font: inherit;
  color: inherit;
  background: transparent;
  appearance: none;
  outline: none;
}

/* Reset 掉原生轮廓后必须提供一致且只对键盘导航出现的替代焦点。 */
button:focus-visible,
input:focus-visible,
textarea:focus-visible,
select:focus-visible,
[tabindex]:focus-visible {
  outline: 2px solid var(--optik-accent);
  outline-offset: -2px;
}

button { cursor: pointer; }

/* 值着色：由 data-type / data-subtype 驱动，原子类无法表达 */
[data-type='string']    { color: var(--optik-token-string); }
[data-type='number']    { color: var(--optik-token-number); }
[data-type='bigint']    { color: var(--optik-token-number); }
[data-type='boolean']   { color: var(--optik-token-boolean); }
[data-type='symbol']    { color: var(--optik-token-boolean); }
[data-type='undefined'] { color: var(--optik-token-null); }
[data-type='function']  { color: var(--optik-token-function); font-style: italic; }
[data-subtype='null']   { color: var(--optik-token-null); }
[data-subtype='error']  { color: var(--optik-level-error-text); }

/* 两栏之间的分隔线：视觉上 1px，命中区向两侧各扩 4px */
.optik-splitter {
  position: relative;
  flex: none;
  width: 1px;
  background: var(--optik-border);
  cursor: col-resize;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.optik-splitter::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -4px;
  right: -4px;
}
.optik-splitter:hover,
.optik-splitter:active,
.optik-splitter:focus-visible {
  background: var(--optik-accent);
}

/* 列表行：悬停与选中态。选中色用 accent 的低透明度叠加，深浅主题都成立。
   钩子是 data-selected 而不是 aria-current——行是「选中按钮 + cURL 按钮」两个兄弟，
   外层容器只负责底色，aria-current 该留在真正被选中的那个按钮上。 */
.optik-row {
  border-bottom: 1px solid var(--optik-border);
}
.optik-row:hover {
  background: var(--optik-bg-elevated);
}
.optik-row[data-selected='true'],
.optik-row[data-selected='true']:hover {
  background: color-mix(in srgb, var(--optik-accent) 16%, transparent);
}
/* color-mix 在旧 WebView 上不支持，退化为一个固定的浅色底 */
@supports not (background: color-mix(in srgb, red 50%, transparent)) {
  .optik-row[data-selected='true'] { background: var(--optik-bg-sunken); }
}

/* 请求分类徽章。
   钩子是 data-kind 而不是原子类——类名由数据拼出，Uno 的静态扫描看不见，
   拼成 text-加分类名 的写法只会静默失效。
   「接口」是唯一填充实色的：一屏静态资源里要能一眼把它捞出来，
   其余分类只用文字颜色区分，避免整个列表变成彩色斑点。 */
.optik-kind {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 徽章不自己定字号，跟着面板那一个 13px 走。
     高度随之从 14px 提到 18px：13px 的中文字身框就是 13px 高，
     留 14px 会把「接口」两个字的上下缘切掉。 */
  height: 18px;
  padding: 0 4px;
  border-radius: 3px;
  font-family: var(--optik-font);
  line-height: 1;
  letter-spacing: 0;
  white-space: nowrap;
  background: var(--optik-bg-sunken);
  color: var(--optik-text-tertiary);
}
.optik-kind[data-kind='api'] {
  background: var(--optik-accent);
  color: var(--optik-accent-contrast);
}
.optik-kind[data-kind='stream'] {
  background: var(--optik-level-info-text);
  color: var(--optik-accent-contrast);
}
.optik-kind[data-kind='script'] { color: var(--optik-token-attr); }
.optik-kind[data-kind='style']  { color: var(--optik-token-boolean); }
.optik-kind[data-kind='image']  { color: var(--optik-token-function); }
.optik-kind[data-kind='font']   { color: var(--optik-token-tag); }
.optik-kind[data-kind='media']  { color: var(--optik-token-number); }
.optik-kind[data-kind='doc']    { color: var(--optik-text-secondary); }

/* 标签栏右缘的渐变。装了插件之后标签会超出一屏，而横向滚动条是被隐藏的，
   没有这道渐变就完全看不出右边还有东西。
   pointer-events: none 是必须的——它盖在最后一个标签上面。 */
.optik-fade-right {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 20px;
  pointer-events: none;
  background: linear-gradient(to right, transparent, var(--optik-bg-elevated));
}

/* 选中的标签额外给一点底色。只靠一条下划线在小屏上不够显眼，
   但底色要压得很淡，否则整条标签栏会变成一排色块。 */
.optik-tab[aria-current='page'] {
  background: color-mix(in srgb, var(--optik-accent) 10%, transparent);
}
@supports not (background: color-mix(in srgb, red 50%, transparent)) {
  .optik-tab[aria-current='page'] { background: var(--optik-bg); }
}

/* 表头：紧凑模式下的列标题，滚动时钉在顶部 */
.optik-thead {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--optik-bg-elevated);
  border-bottom: 1px solid var(--optik-border);
}

/* 隐藏横向标签栏的滚动条，但保留滚动能力 */
.no-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
.no-scrollbar::-webkit-scrollbar { display: none; }

/* 搜索命中高亮 */
mark.optik-hit {
  background: #ffe066;
  color: #1c1c1e;
  border-radius: 2px;
  padding: 0 1px;
}
:host([data-theme='dark']) mark.optik-hit { background: #7a6000; color: #fff8e1; }

@keyframes optik-toast-in {
  from { opacity: 0; transform: translate(-50%, 8px); }
  to   { opacity: 1; transform: translate(-50%, 0); }
}
.optik-toast-anim { animation: optik-toast-in 0.18s ease; }

@keyframes optik-spin { to { transform: rotate(360deg); } }
.optik-spin { animation: optik-spin 0.9s linear infinite; }

@media (prefers-reduced-motion: reduce) {
*, *::before, *::after {
  animation-duration: 0.01ms !important;
  transition-duration: 0.01ms !important;
  }
}
`;
