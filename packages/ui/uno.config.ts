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

/**
 * 控件密度系数。
 *
 * 面板里的按钮、输入框、工具条原本按 4px 基准排布，在真机上偏胖——
 * 一屏高度里有相当一部分被控件本身吃掉了，剩给日志和请求的没多少。
 * 这里统一压到 60%（即缩小 40%），改一个数字全局生效。
 *
 * **它只作用于「留白」，不作用于「盒子」**——这个区分是必须的，
 * 一刀切下去会直接把界面切坏：
 *
 * - 留白类（padding / margin / gap、控件的 min-h）表达的是「这个控件给自己留多少余量」，
 *   缩小它就是在提升密度，正是我们要的。
 * - 盒子类（width / height / max-*）表达的是「这个格子要装下多宽的一列中文、
 *   多大的一个图标」，尺寸是被内容定死的。字号本来就不参与缩放，
 *   盒子跟着缩 40% 而内容不缩，结果就是文字溢出格子压到隔壁列上去。
 *
 * 所以下面把梯度分成两套：SCALED 给留白，RAW 给盒子。
 */
const SCALE = 0.6;

/** 缩放后取整到整数 px：半像素在非高分屏上会让边框和分隔线发虚。 */
const px = (value: number): string => {
  if (value === 0) return '0';
  return `${Math.max(1, Math.round(value * SCALE))}px`;
};

/**
 * 4px 基准的尺寸梯度，覆盖 preset 默认的 rem 值。
 *
 * 梯度要开得足够密：theme 是**深合并**的，没写到的档位会原样保留 preset 的 rem，
 * 而这种漏网完全静默——`h-13` 照样能生成，只是悄悄变回 rem。
 */
const ladder = (scale: (step: number) => string) =>
  Object.fromEntries([
    // 1px 是分隔线、负 margin 这类「就是要一根线」的用法，永远是 1px
    ['px', '1px'],
    // 0 ~ 4.5 保留半档，之后按整数走到 64，末尾补几个大档位给面板宽度用
    ...[0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5].map((s) => [String(s), scale(s * 4)] as const),
    ...Array.from({ length: 60 }, (_, i) => i + 5).map((s) => [String(s), scale(s * 4)] as const),
    ...[72, 80, 96, 112, 120, 128, 144, 160, 176, 192].map(
      (s) => [String(s), scale(s * 4)] as const,
    ),
  ]);

/** 留白梯度：参与密度缩放。 */
const SCALED = ladder(px);
/** 盒子梯度：真实 4px 基准，不缩。 */
const RAW = ladder((value) => (value === 0 ? '0' : `${value}px`));

/**
 * 每个 theme key 都要显式覆盖：不写就还是 preset 的 rem，
 * 连 `tap-target` 的触控底线都会跟着宿主页面的根字号跑。
 *
 * `height` 归到盒子那一侧，意味着 `h-6` 这类写死的高度不再缩。
 * 需要「跟着行高走」的地方不要写死 h-*，用 self-stretch——
 * 那本来也是更该有的写法，写死的数字只是碰巧在缩放前对得上。
 */
const SIZE_THEME = {
  spacing: SCALED,
  minWidth: SCALED,
  minHeight: SCALED,
  width: RAW,
  height: RAW,
  maxWidth: RAW,
  maxHeight: RAW,
};

/** leading-* 同样默认 rem，行高也给成 px，与 fontSize 里的行高保持同一套口径。 */
const lineHeight = Object.fromEntries(
  Array.from({ length: 25 }, (_, i) => [String(i), `${i * 4}px`] as const),
);

export default defineConfig({
  presets: [
    presetWind3({
      // preflight 针对 html/body 与 *，而 Shadow DOM 里 html/body 选择器
      // 匹配不到任何元素。我们在 theme.ts 里自带了一份适配 Shadow DOM 的 reset。
      preflight: false,
    }),
  ],

  theme: {
    ...SIZE_THEME,
    lineHeight,

    /**
     * **整个面板只有一个字号。**
     *
     * 原来这里是一整条 10 / 11 / 12 / 13 / 14 / 15 / 17px 的梯度，七档。
     * 七档的排版梯度是给「有大段正文、需要标题分层」的页面用的；
     * 这个面板不是那样的东西——它通篇是并排的小控件和一行行等长的记录，
     * 每一档字号在这里的作用不是建立层级，而是让相邻的两个东西看着不一样高。
     * 实际后果就是「不是这个按钮大就是另一个按钮大」：
     * 工具条上「清空」13px、「全部」10px，同一排、同样能点、差三分之一。
     *
     * 层级改用别的手段表达——颜色（fg / fg-secondary / fg-tertiary）、
     * 字重、底色。这几样不改变行高，也就不会让同一行的东西错开。
     *
     * 删掉的档位不是留着不用，是**真的删了**：`text-2xs` 这类类名从此生成不出规则，
     * 哪天有人手滑写回去，元素只会安静地继承 13px，绝不会又冒出第二个字号。
     */
    fontSize: {
      base: ['13px', '20px'],
      /**
       * 唯一的例外，而且不是审美选择：
       * iOS Safari 在字号 < 16px 的输入框获得焦点时会强制放大整个页面，
       * 放大之后面板就跑出视口了，用户得手动缩回来。这是平台行为，改不了。
       */
      input: ['16px', '22px'],
    },

    /** 圆角同步缩放：控件矮了却留着 8px 圆角，看上去会变成一颗药丸。 */
    borderRadius: {
      none: '0',
      sm: px(4),
      DEFAULT: px(6),
      md: px(8),
      lg: px(12),
      xl: px(16),
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
    /**
     * 主要命中区。原本取 44px（Apple HIG 的最小可点击尺寸），
     * 经 SCALE 缩放后是 26px——这是刻意压到 HIG 底线以下的取舍：
     * 面板是给开发者在自己手上用的，不是给终端用户的产品界面，
     * 密度优先。要调回去改 uno.config.ts 顶部的 SCALE 一个数即可。
     */
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
    /**
     * 工具条上的按钮。「接口 12」这种带数量的也用它，数字不再降一号字：
     * 中文字面填满整个字身框，阿拉伯数字坐在基线上、下方还空着给 g/y 的降部，
     * 两者字号一旦不同，居中对齐就会让数字看着往下坠——
     * 「这些 0 没有垂直对齐」说的就是这个。同一字号下这个问题不存在。
     */
    chip: 'row-center justify-center px-2.5 min-h-8 rounded border-none bg-transparent text-fg-secondary text-base font-sans not-selectable cursor-pointer',
    /**
     * 单行输入框。高度写死 28px 且**不参与密度缩放**：
     * text-input 的行高就是 22px（字号 16px 是 iOS 的硬性要求，见 fontSize），
     * 加上下边框 2px，24px 已经是物理下限。按 min-h-9 缩放只有 22px，
     * 比行高还矮，浏览器就会把中文的下沿直接切掉。剩下 4px 是留给文字的呼吸。
     */
    field: 'min-w-0 px-2.5 min-h-[28px] rounded-md bg-bg border border-line text-input selectable',
    /**
     * 无边框的紧凑按钮：满足触控底线、按下有明确反馈。
     * 复制这类「点完没有页面变化」的操作全靠这一下按压态告诉用户点中了。
     *
     * `text-base` 是和 btn / chip 对齐的关键一笔：这三个 shortcut 覆盖了面板里
     * 所有可点的东西，字号必须同出一处。之前 icon-btn 不带字号——它当初装的是图标，
     * 字号无所谓——改成放文字之后，每个调用点各自补一个 text-2xs，
     * 于是「清空」13px、「全部」10px 并排站在同一行工具条上。
     * 尺寸差三分之一，眼睛第一时间读到的是「这两个不是一类东西」，
     * 可它们明明都是按钮。
     */
    'icon-btn':
      'row-center justify-center shrink-0 rounded-md border-none bg-transparent text-fg-secondary text-base font-sans not-selectable cursor-pointer active:bg-bg-sunken active:scale-95 transition-transform',
    /**
     * 列表行尾那一列常驻的复制按钮。控制台和网络两个面板共用这一条，
     * 不再各写各的——它们本来就是同一个东西摆在同一个位置，
     * 之前一个贴顶、一个垂直居中，两个面板来回切的时候按钮会在眼里跳一下。
     *
     * **贴顶（items-start）而不是居中**：一条报错展开调用栈之后能有十几行高，
     * 按钮居中就跟着掉到行的中间去了，一列扫下来高高低低。贴顶则永远在
     * 每一行的右上角，位置可预测。命中区仍是整行高度（self-stretch）。
     *
     * 48px 是按「已复制」量的：13px 三个中文字 39px，两侧各留 4px 余量。
     * 不分紧凑/舒适两档——同一颗按钮在两种密度下宽窄不一，
     * 正是「不是这个按钮大就是另一个按钮大」的另一种写法。
     */
    'copy-col':
      'w-12 self-stretch items-start pt-1.5 rounded-none border-l border-line text-fg-tertiary',
  },

  // CLI 是按词扫描源码的，代码里出现的 `px`、`ms` 会被当成类名，
  // 命中 padding-x / margin-inline-start，生成两条谁也没用的规则。
  blocklist: ['px', 'ms'],

  // 这些类名由数据驱动动态拼接，静态扫描看不到，必须显式保留。
  safelist: [
    // 只作为 classList 的键出现，不在 class 字符串里，扫描器不一定认得
    'invisible',
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
