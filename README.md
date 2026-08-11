# Optik Sol

[![npm](https://img.shields.io/npm/v/optik-sol.svg)](https://www.npmjs.com/package/optik-sol)
[![CI](https://github.com/Moresyl/optik-sol/actions/workflows/ci.yml/badge.svg)](https://github.com/Moresyl/optik-sol/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/optik-sol.svg)](LICENSE)

移动端网页调试面板。一个 `<script>` 标签，零服务端，零运行时依赖。

手机上排查问题最难受的从来不是「看不到日志」，而是**看到了拿不出来、点不中、展开就卡死**。
Optik 的每一处设计都是冲着这些具体的失败场景去的。

```html
<script src="https://unpkg.com/optik-sol"></script>
```

就这一行。脚本一执行就开始记录——放在 `<head>` 里也不用等 `DOMContentLoaded`，
页面启动阶段的报错和请求一条都不会丢。

---

## 装它的理由

### 复制这件事，做到了物理上不会失败

真机调试基本都跑在 `http://192.168.x.x:5173` 这种地址上，而**浏览器只在安全上下文里提供
剪贴板接口**——这意味着 `navigator.clipboard` 在最需要它的场景里恰好不存在。

Optik 的复制是三层降级：

1. `document.execCommand('copy')`，同步执行以保住用户手势
2. 异步剪贴板接口（可用时）
3. 都失败 → 弹出一个**内容已全选的文本框**，用户长按选「拷贝」即可

第三层不依赖任何 API，物理上不可能失败。

顺带说一句第一层的坑：在 Shadow DOM 里 `execCommand('copy')` 读的是 *document* 的选区，
而它看不见 shadow 内容——所以那个临时输入框必须放在明亮 DOM 里，还得有实际尺寸、
不能是 `readonly`、字号要 16px，并且同时设置 `Range` 和 `setSelectionRange`。
少一样都不行。

### 长按能选中文字

```css
user-select: text;
-webkit-user-select: text;
-webkit-touch-callout: default;
```

三行 CSS，但前提是**手势处理器不能在 `touchstart` 上调 `preventDefault()`**，
否则原生长按选中直接失效。Optik 的长按检测是纯观察型的，全程 `passive`，
从不 `preventDefault`——它在原生行为之上追加能力，而不是取代它。

### 展开十万元素的数组不会卡死

日志产生时只做**一层浅预览**，真实对象留在注册表里，由不透明句柄引用；
用户点开哪一层才读哪一层。所以：

| 场景 | 结果 |
| --- | --- |
| 循环引用 | 标注 `[Circular]`，不栈溢出 |
| 十万元素数组 | 即时展开，主线程不阻塞 |
| `Map` / `Set` | 作为 `[[Entries]]` 展开 |
| 函数 / `Symbol` / `BigInt` | 如实显示，不被丢弃 |
| DOM 节点 | 显示为节点，不是 `{}` |
| 带 getter 的对象 | 显示 `(...)`，**绝不触发求值** |
| 跨 iframe 的对象 | 正确识别（不依赖 `instanceof`） |

句柄的生命周期跟环形缓冲绑定：日志被挤出缓冲区，对应对象同时释放。
内存有上界，长时间开着不会越用越卡。

### 布局按 iOS 的真实规则来

- **`100dvh` 而不是 `100vh`**。iOS 的 `100vh` 把可折叠的地址栏算了进去，
  用 `vh` 会让面板底部的操作栏被永久遮住，怎么都点不到
- 所有边缘都带 `env(safe-area-inset-*)`
- 触控目标不小于 44px（Apple HIG）
- 所有输入框字号 **16px**——低于这个值 Safari 会在聚焦时强制放大整个页面
- 尺寸**全部用 px，不用 rem**。移动端项目普遍用 flexible.js / postcss-pxtorem
  把 `html { font-size }` 改成 37.5px 之类的值，而 `rem` 在 Shadow DOM 里
  仍然相对根元素解析——用 rem 的面板注入这类页面会整体变形

### 宽了就分栏，窄了才钻入

两个维度是**分开**判断的，因为它们真的会分开出现：

- **宽度**决定分不分栏。≥ 640px 时列表在左、详情在右，中间一条可拖拽的分隔线，
  比例记在本地；窄屏保持钻入式，390px 上强行分栏两边都没法看
- **指针类型**决定行高。横屏手机宽度能到 932px，够分栏了，但输入方式还是手指——
  所以紧凑排版由 `pointer: fine` 决定，触屏下所有行仍不低于 44px

量的是**面板自己的宽度**而不是视口，用的是 `ResizeObserver`。
另外分栏且选中某一项时，左栏会自动收起「类型/大小/耗时」几列，
不然名称会被挤得只剩几个字。

### 复制固定在每一行的行尾

复制是这个工具存在的理由，所以它不该藏在任何一层下面。控制台和网络列表的
**每一行行尾都常驻一个按钮**，位置固定在同一个 x 上，一列扫下来手不用挪：

- 控制台 →「复制」，带时间戳、等级、来源与完整调用栈
- 网络 →「cURL」，一条可以直接粘到电脑上重放的完整命令

触屏下这一列宽 44px，鼠标下收窄到 40px 给内容让位。控制台的按钮贴顶对齐——
一条报错展开调用栈能有十几行高，按钮跟着居中就找不着了，但命中区仍是整行。

WebSocket 那几行不给 cURL：curl 对 `ws://` 的支持是实验性的，
给一条注定跑不通的命令比不给更糟。位置仍然占着，列不会错位。

往回翻历史时自动跟随会停掉，此时右下角出现「↓ 最新」。贴着底部时它不存在——
底部常驻一排跳转按钮是在为一个偶尔发生的需求永久收税。

### 不污染被调试的页面

整个面板活在 Shadow DOM 里，双向隔离：宿主页面的全局重置、`!important`、
UI 库样式进不来，我们的样式也一个字节漏不出去。被调试的页面不该因为接了调试器而变样，
否则调试本身就成了新的变量。

所有插桩都是**可完整还原**的：始终透传原方法、带重入保护、从不向宿主抛异常，
`destroy()` 时按原始属性描述符逐一还原。

---

## 面板

| 标签 | 内容 |
| --- | --- |
| **控制台** | 各级别日志、分组、重复合并、`%c` 样式、正则搜索+命中高亮、**每行直接复制**、勾选批量复制、表达式求值（`$_` 引用上次结果） |
| **网络** | XHR / Fetch / sendBeacon / WebSocket / EventSource / 静态资源，请求响应头与体、**DNS·TCP·TLS·等待·下载分段耗时**、WebSocket 逐帧记录、**每行直接复制 cURL** |
| **元素** | DOM 树惰性浏览、页面内拾取、高亮、盒模型、计算样式、复制选择器 |
| **存储** | localStorage / sessionStorage / Cookie / IndexedDB，可增删改查 |
| **环境** | 设备、视口、**安全区**、内存、加载时序、**能力探测** |

「能力探测」值得单说：面板的一些行为会随环境降级（非 HTTPS 没有剪贴板接口、
隐私模式没有本地存储）。把这些结论直接摆出来，用户遇到功能不生效时能立刻知道原因，
而不是怀疑工具坏了。

### 别人通常没有的

- **资源加载失败**（`<img>` / `<script>` / CSS 404）。这类 error 事件**不冒泡**，
  只有捕获阶段能拿到
- **CSP 违规报告**
- **sendBeacon 的实际接受与否**——只记录调用而不报告浏览器是否接受，等于没记
- **EventSource（SSE）**
- **没有 JS API 的请求**（图片、字体、CSS），走 Resource Timing 捕获
- 缓存命中标记（`transferSize === 0 && decodedBodySize > 0`）

---

## 用法

### script 标签

```html
<script
  src="https://unpkg.com/optik-sol"
  data-theme="dark"
  data-max-logs="2000"
></script>
```

| 属性 | 说明 |
| --- | --- |
| `data-theme` | `auto`（默认）/ `light` / `dark` |
| `data-open` | 存在则默认展开面板 |
| `data-max-logs` | 日志条数上限，默认 1000 |
| `data-max-requests` | 请求条数上限，默认 300 |
| `data-optik-manual` | 存在则**不**自动挂载，由你自己调 `Optik.mount()` |

挂载后可用 `window.Optik`。

### 打包器

```bash
npm i optik-sol
```

```js
import { mount } from 'optik-sol';

// 建议只在非生产环境挂载
if (import.meta.env.DEV) {
  mount({ theme: 'auto' });
}
```

### API

```ts
const optik = mount({
  theme: 'auto',           // 'auto' | 'light' | 'dark'
  defaultOpen: false,
  defaultTab: 'console',
  log: { maxEntries: 1000 },
  network: { maxRecords: 300 },
  capture: { console: true, errors: true, network: true },
  passthrough: true,       // 是否继续调用原生 console，默认 true
  maxBodyBytes: 512 * 1024,
});

optik.show('network');
optik.hide();
optik.use(plugin);
optik.eject('plugin-id');
optik.destroy();           // 完整还原所有插桩
```

### 插件

插件**不需要依赖 Solid**——返回一个原生 DOM 节点就行。

```js
optik.use({
  id: 'my-tool',
  label: '业务工具',
  render(context) {
    const root = document.createElement('div');
    const button = document.createElement('button');
    button.textContent = '复制全部日志';
    button.onclick = () => {
      const text = context.kernel.log.entries().map((e) => e.text).join('\n');
      // 复用面板的三级复制策略，非 HTTPS 下同样保证成功
      context.copy(text, '日志');
    };
    root.appendChild(button);
    return root;
  },
});
```

`context` 提供 `kernel` / `copy` / `reveal` / `log` / `theme`。

---

## 结构

| 包 | 说明 |
| --- | --- |
| `optik-sol` | 唯一公开包，`<script>` 与 `import` 两种接入都从这里进 |
| `optik-core` | 内部包，不单独发布。负责插桩、值镜像与环形缓冲 |
| `optik-ui` | 内部包，不单独发布。负责 Solid + Shadow DOM 面板 UI |

内核与 UI 之间走的是 **CDP（Chrome DevTools Protocol）形状**的消息：
`Request {id, method, params}` / `Response {id, result|error}` / `Event {method, params}`，
中间隔着一层 `Transport` 抽象。今天这层跑在进程内；换成 WebSocket 就是远程调试，
内核一行不用改。

体积（gzip）：单文件 IIFE 约 46 KB，内核单独用约 21 KB。

---

## 开发

```bash
pnpm install
pnpm build

pnpm dev          # 启动验证台
```

验证台页面顶部直接给出局域网地址和二维码，手机扫码就能打开——
浏览器自己查不到 `192.168.x.x`，这个地址是 Vite 侧把 `resolvedUrls.network`
注入进页面的。Windows 上 `--host` 会把 WSL、Hyper-V 的虚拟网卡一起列出来，
所以列表按网段排了序，真正能用的排在最前面。

页面里每个按钮都对应一个**已知会让调试工具出问题的场景**——循环引用、十万元素数组、
带副作用的 getter、跨 realm 对象、不冒泡的资源错误、不透明跨域响应。
拿手机扫码打开，逐个点过去。

## 参与

欢迎提 Issue 和 PR。动手之前请先读 [CONTRIBUTING.md](CONTRIBUTING.md)——
里面有一个必须知道的坑（UnoCSS 是 CLI 生成的，新 class 不重新生成就静默失效），
以及几条不可协商的约束（只用 px、触控目标 44px、插桩必须可完整还原）。

- 行为准则：[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- 安全问题：[SECURITY.md](SECURITY.md)，请勿通过公开 Issue 报告
- 变更记录：[CHANGELOG.md](CHANGELOG.md)

## 许可

MIT，见 [LICENSE](LICENSE)。
