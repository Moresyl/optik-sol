<div align="center">

# Optik Sol

**移动端网页调试面板。一个 `<script>` 标签，零服务端，零运行时依赖。**

[![npm](https://img.shields.io/npm/v/optik-sol.svg)](https://www.npmjs.com/package/optik-sol)
[![CI](https://github.com/Moresyl/optik-sol/actions/workflows/ci.yml/badge.svg)](https://github.com/Moresyl/optik-sol/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/optik-sol.svg)](LICENSE)

[English](README.md) | 简体中文

</div>

---

Optik Sol 把一整套调试面板放进手机浏览器或 WebView 里的任何页面——单文件，gzip 约 64 KB。

```html
<script src="https://unpkg.com/optik-sol"></script>
```

脚本一执行就开始记录，放在 `<head>` 里也不用等 `DOMContentLoaded`，页面启动阶段的报错和请求一条都不会丢。

## 面板

| 标签 | 内容 |
| --- | --- |
| **控制台** | 各级别日志、分组、重复合并、`%c` 样式、正则搜索与高亮、勾选批量复制、表达式求值（`$_` 引用上次结果） |
| **网络** | XHR / Fetch / sendBeacon / WebSocket / EventSource / 静态资源，请求响应头与体、分段耗时、WebSocket 逐帧记录、默认脱敏的 HAR 1.2 导出 |
| **元素** | DOM 树惰性浏览、页面内拾取、高亮、盒模型、计算样式、复制选择器 |
| **存储** | localStorage / sessionStorage / Cookie / IndexedDB，可增删改查 |
| **环境** | 设备、视口、安全区、内存、加载时序、有上限的主线程长任务证据、能力探测 |

## 特点

| 行为 | 说明 |
| --- | --- |
| **复制不会失败** | 三层降级：`execCommand` → 异步剪贴板接口 → 全选文本框兜底。最后一层不依赖任何 API，`http://192.168.x.x` 这类非安全上下文下同样可用 |
| **复制常驻行尾** | 控制台每行「复制」（含时间戳与调用栈），网络每行「cURL」。位置固定在同一个 x 上，不随内容长短漂移 |
| **展开大对象不卡** | 只做一层浅预览，真实对象由句柄引用。十万元素数组即时展开，循环引用标注 `[Circular]`，getter 显示 `(...)` 且绝不求值 |
| **长按能选中文字** | 手势检测全程 `passive`，从不 `preventDefault`，不夺走原生长按选中 |
| **按移动端规则布局** | `100dvh`、`env(safe-area-inset-*)`、触控目标 ≥ 44px、输入框 16px、尺寸只用 px 不用 rem |
| **宽了分栏，窄了钻入** | 面板宽度 ≥ 640px 分栏（比例记在本地），`pointer: fine` 下切紧凑排版，触屏下行高不变 |
| **不污染宿主页面** | 整个面板活在 Shadow DOM 里双向隔离；所有插桩透传原方法，`destroy()` 按原始属性描述符逐一还原 |

还捕获一些常被漏掉的信号：资源加载失败（`<img>` / `<script>` / CSS 404，这类事件不冒泡）、CSP 违规、sendBeacon 的实际接受与否、EventSource、没有 JS API 的请求（走 Resource Timing）、缓存命中。

设计取舍的完整来由见 [DESIGN.zh-CN.md](DESIGN.zh-CN.md)。

## 用法

### script 标签

```html
<script src="https://unpkg.com/optik-sol" data-theme="dark" data-max-logs="2000"></script>
```

| 属性 | 说明 |
| --- | --- |
| `data-theme` | `light`（默认）/ `dark` |
| `data-open` | 存在则默认展开面板 |
| `data-max-logs` | 日志条数上限，默认 5000 |
| `data-max-requests` | 请求条数上限，默认 1000 |
| `data-max-long-tasks` | 主线程长任务条数上限，默认 200 |
| `data-optik-manual` | 存在则**不**自动挂载，由你自己调 `Optik.mount()` |

挂载后可用 `window.Optik`。

### 打包器

```bash
npm i optik-sol
```

```js
import { mount } from 'optik-sol';

if (import.meta.env.DEV) {
  mount();
}
```

> 不要在生产环境无条件挂载：面板会读取请求头、请求体与本地存储，并对页面上任何脚本可达。

### API

```ts
const optik = mount({
  theme: 'light',          // 'light' | 'dark'
  defaultOpen: false,
  defaultTab: 'console',
  log: { maxEntries: 1000 },
  network: { maxRecords: 300 },
  performance: { maxLongTasks: 200 },
  capture: {
    console: true,
    exceptions: true,
    rejections: true,
    resourceErrors: true,
    cspViolations: true,
    xhr: true,
    fetch: true,
    beacon: true,
    websocket: true,
    eventSource: true,
    resourceTiming: true,
    longTasks: true,
  },
  passthrough: true,       // 是否继续调用原生 console，默认 true
  maxBodyBytes: 512 * 1024,
});

optik.show('network');
optik.hide();
optik.use(plugin);
optik.eject('plugin-id');
optik.destroy();           // 完整还原所有插桩
```

网络面板可直接复制安全模式的 HAR 1.2：默认不导出请求/响应正文与 WebSocket 帧正文，
同时脱敏请求头、URL 和查询参数中的凭据。代码中可使用 `serializeHar(records)`，并通过
`{ includeBodies: true, includeWebSocketFrames: true }` 显式加入已留存的正文；支持识别的
JSON/表单字段仍会脱敏。还需额外传入 `{ redactSensitive: false }` 才会导出原值。

环境面板还会保留浏览器报告的主线程长任务（至少 50ms），显示累计/最长耗时及可用的
浏览上下文归因。记录有固定上限，可用 `capture.longTasks: false` 关闭采集。

### 协议传输

公开协议层可把有上限的日志、网络记录、长任务、系统信息及其实时事件提供给 Worker
或远程客户端。采集内容可能含敏感信息，因此只能绑定可信或已认证的 transport。

```ts
const [clientSide, kernelSide] = createInProcessTransportPair();
const server = attachKernelProtocol(optik.kernel, kernelSide);
const client = new ProtocolClient(clientSide);

const { entries, total } = await client.request(KernelProtocolMethods.LogEntries, {
  offset: 0,
  limit: 100,
});

client.close();
server.dispose();
```

列表命令支持分页，每次响应最多 1000 项。对象展开会向内核借用子句柄，用完后应调用对应的
`Log.releaseObject` 或 `Network.releaseObject` 命令；服务端会在会话销毁时释放全部遗留借用。

### 插件

插件不需要依赖 Solid，返回一个原生 DOM 节点即可。

```js
optik.use({
  id: 'my-tool',
  label: '业务工具',
  render(context) {
    const button = document.createElement('button');
    button.textContent = '复制全部日志';
    button.onclick = () => {
      const text = context.kernel.log.entries().map((e) => e.text).join('\n');
      context.copy(text, '日志');
    };
    return button;
  },
});
```

`context` 提供 `kernel` / `copy` / `reveal` / `log` / `theme`。

## 结构

| 包 | 说明 |
| --- | --- |
| `optik-sol` | 唯一发布包，`<script>` 与 `import` 两种接入都从这里进 |
| `optik-core` | 内部包。插桩、值镜像、环形缓冲，零依赖，不碰 DOM |
| `optik-ui` | 内部包。Solid + Shadow DOM + UnoCSS 面板 UI |

内核与 UI 之间走 CDP 形状的消息，中间隔着一层 `Transport`。今天跑在进程内，换成 WebSocket 就是远程调试，内核一行不用改。

## 开发

```bash
pnpm install
pnpm dev          # 启动验证台，页面顶部给出局域网地址和二维码
pnpm typecheck
pnpm build
```

验证台里每个按钮都对应一个已知会让调试工具出问题的场景。详见 [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md)。

## 文档

[贡献指南](CONTRIBUTING.zh-CN.md) · [设计说明](DESIGN.zh-CN.md) · [安全策略](SECURITY.zh-CN.md) · [行为准则](CODE_OF_CONDUCT.zh-CN.md) · [更新日志](CHANGELOG.zh-CN.md)

## 许可

MIT，见 [LICENSE](LICENSE)。
