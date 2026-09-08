# 快速开始

Optik Sol 是嵌入被调试页面的移动端开发者工具。它不需要代理服务器、USB 连接或浏览器扩展，适合复现只在手机浏览器、企业 WebView、微信或内置浏览器里出现的问题。

## 环境要求

- 现代移动浏览器或 WebView；功能按能力探测自动降级
- npm 接入需要 Node.js 20 或更高版本
- 页面必须允许加载脚本；严格 CSP 环境需要将资源加入 `script-src`

## 方式一：直接使用 CDN

使用明确版本，避免调试现场因 `latest` 漂移而不可复现：

```html
<script
  src="https://unpkg.com/optik-sol@0.4.1"
  data-theme="light"
  data-max-logs="2000"
  data-max-requests="500"
></script>
```

脚本在执行时立即安装采集器；即使放在 `<head>`，也不会等待 `DOMContentLoaded`，因此可以保留启动阶段的异常和请求。

## 方式二：通过 npm 按需挂载

```bash
npm install optik-sol@0.4.1
```

```ts
import { mount } from 'optik-sol';

const optik = import.meta.env.DEV
  ? mount({ defaultOpen: false, theme: 'light' })
  : undefined;

// 需要时打开到指定面板
optik?.show('network');

// 页面卸载或热更新时完整还原所有插桩
optik?.destroy();
```

`mount()` 重复调用会返回当前实例，不会叠加多个面板。

## 方式三：CDN 手动挂载

如果你希望先加载脚本、通过业务授权后再启用面板：

```html
<script
  src="https://unpkg.com/optik-sol@0.4.1"
  data-optik-manual
></script>
<script>
  if (new URL(location.href).searchParams.get('debug') === '1') {
    window.Optik.mount({ defaultOpen: true });
  }
</script>
```

::: danger 不要把查询参数当作生产环境鉴权
上面的 `debug=1` 只适合本地演示。生产环境应由服务端签发短期授权，或仅在内部构建中包含 Optik。
:::

## 验证接入

打开面板后按以下顺序检查：

1. **控制台**：执行 `console.log({ ready: true })`，应看到可展开对象。
2. **网络**：发起一个 Fetch 请求，应看到状态、时序、请求/响应正文与 cURL。
3. **环境**：查看能力探测，确认当前 WebView 的降级项。
4. **销毁**：调用 `Optik.instance()?.destroy()`，悬浮球应消失，原生方法应恢复。

## 下一步

- 调整采集上限与开关：[配置参考](/guide/configuration)
- 复制安全 HAR、绑定插件与 transport：[实战配方](/guide/recipes)
- 遇到空正文、复制失败或 WebView 差异：[故障排查](/guide/troubleshooting)
