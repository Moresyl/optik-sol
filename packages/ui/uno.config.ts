import { defineConfig, presetWind3 } from 'unocss';

/**
 * UnoCSS 配置：Tailwind 兼容语法，但整套 theme 强制 px。
 *
 * **为什么必须是 px 而不是默认的 rem：**
 * `rem` 永远相对根元素 `<html>` 的字号解析，Shadow DOM 也不例外。
 * 而移动端项目普遍使用 flexible.js / postcss-pxtorem 这类适配方案，
 * 会把 `html { font-size }` 动态改成 37.5px 之类的值。
 * 如果面板用 rem，注入到这种页面里会整体变形——而这恰恰是本项目的主战场。
 * 用 px 之后，面板的尺寸与宿主页面完全解耦。
 */

/** 4px 基准的间距梯度，覆盖 preset 默认的 rem 值。 */
const spacing = Object.fromEntries([
  ['0', '0px'],
  ['px', '1px'],
  ['0.5', '2px'],
  ...[1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 56, 64, 80, 96].map(
    (step) => [String(step), `${step * 4}px`] as const,
  ),
]);

export default defineConfig({
  presets: [
    presetWind3({
      // preflight 针对 html/body 与 *，而 Shadow DOM 里 html/body 选择器
      // 匹配不到任何元素。我们在 theme.ts 里自带了一份适配 Shadow DOM 的 reset。
      preflight: false,
    }),
  ],

  theme: {
    spacing,

    fontSize: {
      '2xs': ['10px', '14px'],
      xs: ['11px', '16px'],
      sm: ['12px', '18px'],
      base: ['13px', '20px'],
      md: ['14px', '21px'],
      lg: ['15px', '22px'],
      xl: ['17px', '24px'],
      // 表单控件专用：iOS Safari 在字号 < 16px 的输入框聚焦时会强制缩放页面，
      // 所以 16px 不是审美选择，是硬性约束。
      input: ['16px', '22px'],
    },

    borderRadius: {
      none: '0',
      sm: '4px',
      DEFAULT: '6px',
      md: '8px',
      lg: '12px',
      xl: '16px',
      full: '9999px',
    },

    /** 颜色全部指向 CSS 变量，深浅主题由 :host 上的属性切换。 */
    colors: {
      bg: {
        DEFAULT: 'var(--optik-bg)',
        elevated: 'var(--optik-bg-elevated)',
        sunken: 'var(--optik-bg-sunken)',
      },
      fg: {
        DEFAULT: 'var(--optik-text)',
        secondary: 'var(--optik-text-secondary)',
        tertiary: 'var(--optik-text-tertiary)',
      },
      line: {
        DEFAULT: 'var(--optik-border)',
        strong: 'var(--optik-border-strong)',
      },
      accent: {
        DEFAULT: 'var(--optik-accent)',
        fg: 'var(--optik-accent-contrast)',
      },
      warn: {
        DEFAULT: 'var(--optik-level-warn-text)',
        bg: 'var(--optik-level-warn-bg)',
        line: 'var(--optik-level-warn-border)',
      },
      danger: {
        DEFAULT: 'var(--optik-level-error-text)',
        bg: 'var(--optik-level-error-bg)',
        line: 'var(--optik-level-error-border)',
      },
      debug: 'var(--optik-level-debug-text)',
      info: 'var(--optik-level-info-text)',
    },

    fontFamily: {
      sans: 'var(--optik-font)',
      mono: 'var(--optik-mono)',
    },
  },

  /**
   * 深色主题变体。
   * 默认的 `dark:` 会生成 `.dark .x`，但我们的开关挂在宿主元素上，
   * 所以重写成 `:host([data-theme="dark"]) .x`。
   */
  variants: [
    (matcher) => {
      if (!matcher.startsWith('dark:')) return matcher;
      return {
        matcher: matcher.slice(5),
        selector: (s) => `:host([data-theme="dark"]) ${s}`,
      };
    },
  ],

  shortcuts: {
    /** 44px 是 Apple HIG 的最小可点击尺寸，真机上小于它很难点中。 */
    'tap-target': 'min-h-11 min-w-11',
    'row-center': 'flex items-center',
    /**
     * 可选中文本。iOS 上没有这组声明就无法长按选中，也就无从复制——
     * 这是整个项目最关键的一组样式，做成 shortcut 避免任何地方漏写。
     */
    selectable: 'select-text [-webkit-user-select:text] [-webkit-touch-callout:default]',
    'not-selectable': 'select-none [-webkit-user-select:none]',
    /** 长 token（base64 / 堆栈 / URL）必须能断行，否则会撑出横向滚动。 */
    'wrap-anywhere': '[overflow-wrap:anywhere] break-words whitespace-pre-wrap',
    btn: 'row-center justify-center gap-1 px-3 min-h-9 rounded-md border border-line bg-bg text-fg text-base font-sans not-selectable cursor-pointer active:bg-bg-sunken disabled:opacity-40',
    'btn-primary': 'btn bg-accent border-accent text-accent-fg',
    chip: 'row-center justify-center px-2.5 min-h-8 rounded border-none bg-transparent text-fg-secondary text-base font-sans not-selectable cursor-pointer',
  },

  // 这些类名由数据驱动动态拼接，静态扫描看不到，必须显式保留。
  safelist: [
    'text-danger',
    'text-warn',
    'text-debug',
    'text-info',
    'bg-danger-bg',
    'bg-warn-bg',
    'border-danger-line',
    'border-warn-line',
  ],
});
