# 参与贡献

**改代码之前，先拿手机打开验证台。** 这个项目的设计决策绝大多数来自真机上的失败场景，在桌面 Chrome 里看着没问题的改动，到手机上可能整个逻辑都不成立。

## 环境

Node ≥ 20，pnpm 10（仓库锁了 `packageManager`，`corepack enable` 会自己对上版本）。

```bash
pnpm install
pnpm dev          # 启动验证台，页面顶部给出局域网地址和二维码
pnpm typecheck
pnpm build
```

CI 跑的就是 `typecheck` + `build`，外加检查产物非空。本地过了 CI 基本就过了。

## 一个必须知道的坑：UnoCSS 不是 Vite 插件

`optik-ui` 的样式是 CLI 生成的，不是运行时按需生成的：

```bash
pnpm --filter optik-ui css     # 扫 src/**/*.{ts,tsx} → src/generated/uno.css
```

`packages/ui/src/index.ts` 把这个产物 `?inline` 内联进 Shadow DOM。**所以新写的 class 名在重新生成之前是不存在的**——不会报错，只会静默失效：写个 `w-10` 的按钮，它塌成内容宽度，看起来像是布局写错了。

`pnpm dev` 已经带上 watch。但如果单独跑 `vite`，或刚 checkout 完直接 build，记得先跑一次 `css`。`src/generated/` 不进版本库。

## 硬约束

不可协商，理由见 [DESIGN.md](DESIGN.md)。

- 界面文案一律**中文**，包括 `aria-label`、`title`、toast 与空状态
- 尺寸只用 **px**，不用 rem
- 触控目标 ≥ **44px**，输入框字号 ≥ **16px**（鼠标下可收窄，触屏下不行）
- 高度用 **`100dvh`**，边缘带 `env(safe-area-inset-*)`
- 插桩必须**可完整还原**：透传原方法、带重入保护、从不向宿主抛异常，`destroy()` 按原始属性描述符还原
- 内核里**不许出现任何 DOM 引用**，UI 也不许绕过 `Transport` 直接摸内核内部状态
- 注释写「为什么」，不写「是什么」

## 目录

| 路径 | 说明 |
| --- | --- |
| `packages/core` | 内核：插桩、值镜像、环形缓冲 |
| `packages/ui` | 面板 UI |
| `packages/optik` | 发布包 `optik-sol`，产出 ESM / CJS / IIFE |
| `playground` | 验证台，不发布 |

## 验证

验证台里每个按钮都对应一个**已知会让调试工具出问题的场景**：循环引用、十万元素数组、带副作用的 getter、跨 realm 对象、不冒泡的资源错误、不透明跨域响应。

改动涉及下面任何一项，请在真机（或设备模拟 + 触摸仿真）上确认：

- 复制链路，尤其是 **HTTP 非安全上下文**下的降级路径
- 长按选中文字（手势处理器一旦 `preventDefault` 就失效）
- 分栏阈值（≥ 640px）与紧凑排版（`pointer: fine`）
- 安全区、软键盘弹出后的布局

## 提 PR / 报 Bug

一个 PR 做一件事。描述里写清楚**改之前会怎么坏**，比写改了什么有用；UI 改动请附截图或录屏，最好是手机上的。

报 Bug 请务必带上：**机型 + 系统版本、浏览器或 WebView、页面协议是 HTTPS 还是 HTTP、Optik Sol 版本**。缺任何一项都可能让问题无法复现。
