# 参与贡献

先说结论：**改代码之前，先拿手机打开验证台**。这个项目的绝大多数设计决策都来自真机上的
失败场景，在桌面 Chrome 里看着没问题的改动，到手机上可能整个逻辑都不成立。

## 环境

- Node ≥ 20
- pnpm 10（仓库里锁了 `packageManager`，用 `corepack enable` 让它自己对上版本）

```bash
pnpm install
pnpm dev          # 启动验证台，顶部直接给局域网地址和二维码
```

`pnpm dev` 会**并行**跑两件事：UnoCSS 的 watch 和 Vite。两个都得活着，原因见下一节。

## 一个必须知道的坑：UnoCSS 不是 Vite 插件

`@optik/ui` 的样式是 CLI 生成的，不是运行时按需生成的：

```bash
pnpm --filter @optik/ui css     # 扫 src/**/*.{ts,tsx} → src/generated/uno.css
```

`packages/ui/src/index.ts` 里 `import unoStyles from './generated/uno.css?inline'`
把这个产物内联进 Shadow DOM。**所以你新写的 class 名在重新生成之前是不存在的**——
不会报错，只会静默失效：写个 `w-10` 的按钮，它会塌成内容宽度，看起来像是布局写错了。

`pnpm dev` 已经带上了 watch，正常开发不用管；但如果你是单独跑 `vite`，或者刚 checkout
完直接 build，记得先跑一次 `css`。`src/generated/` 不进版本库。

## 提交前

```bash
pnpm typecheck
pnpm build
```

CI 跑的就是这两条，外加检查三个包的产物非空。本地过了 CI 基本就过了。

## 写代码的约定

**界面文案一律中文。** 包括 `aria-label`、`title`、toast 文案、空状态提示。

**尺寸只用 px，不用 rem。** 移动端项目普遍用 flexible.js / postcss-pxtorem 把
`html { font-size }` 改成 37.5px 之类的值，而 `rem` 在 Shadow DOM 里仍然相对根元素解析。
用 rem 的面板注入这类页面会整体变形。主题里也只有 px。

**触控目标不小于 44px**（Apple HIG），输入框字号不低于 **16px**（低于这个值 Safari
聚焦时会强制放大整个页面）。鼠标下（`pointer: fine`）可以收窄，触屏下不行。

**高度用 `100dvh`，不用 `100vh`**；所有边缘带 `env(safe-area-inset-*)`。

**插桩必须可完整还原。** 始终透传原方法、带重入保护、从不向宿主抛异常，
`destroy()` 时按原始属性描述符逐一还原。被调试的页面不该因为接了调试器而改变行为——
否则调试本身就成了新的变量。

**注释写「为什么」，不写「是什么」。** 这个仓库里的注释大多在记录某个反直觉的约束
（比如「`execCommand('copy')` 读的是 document 的选区，看不见 shadow 内容」），
它们的价值在于挡住下一个人的回退式改动。

## 目录

| 包 | 说明 |
| --- | --- |
| `packages/core` | 内核：插桩、值镜像、环形缓冲。**零依赖**，不碰 DOM |
| `packages/ui` | 面板 UI（Solid + Shadow DOM + UnoCSS） |
| `packages/optik` | 门面包，产出 ESM / CJS / IIFE 三份 |
| `playground` | 验证台，不发布 |

内核与 UI 之间走 CDP 形状的消息，中间隔着 `Transport` 抽象。改内核时请守住这条边界：
**内核不许出现任何 DOM 引用**，UI 也不许绕过 Transport 直接摸内核内部状态。
这层边界的存在意义是有朝一日把 Transport 换成 WebSocket 就能做远程调试。

## 验证

`playground` 里每个按钮都对应一个**已知会让调试工具出问题的场景**——循环引用、
十万元素数组、带副作用的 getter、跨 realm 对象、不冒泡的资源错误、不透明跨域响应。

改动涉及以下任何一块，请至少在真机（或 Chrome 的设备模拟 + 触摸仿真）上确认：

- 复制链路（尤其是 **HTTP 非安全上下文**下的降级路径）
- 长按选中文字（手势处理器一旦 `preventDefault` 就会失效）
- 分栏阈值（面板宽度 ≥ 640px）与紧凑排版（`pointer: fine`）
- 安全区、软键盘弹出后的布局

## 提 PR

- 一个 PR 做一件事，标题用祈使句，中文英文都行
- 描述里写清楚**改之前会怎么坏**，比写改了什么更有用
- 涉及 UI 的改动请附上截图或录屏，最好是手机上的

## 报 Bug

请务必带上：机型 + 系统版本 + 浏览器/WebView、页面是 HTTPS 还是 HTTP、
以及 Optik 的版本。这三样里任何一样缺失，都可能让问题完全无法复现。
