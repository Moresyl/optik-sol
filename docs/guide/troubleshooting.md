# 故障排查

## 没有出现悬浮球

1. 检查控制台是否有 `[optik] automatic mount failed`。
2. 如果脚本带 `data-optik-manual`，必须手动调用 `Optik.mount()`。
3. 检查 CSP 是否允许当前 CDN 或自托管脚本。
4. 确认页面存在 `document.documentElement`，且没有在脚本执行期间移除 Optik 宿主节点。

## 请求有记录，但正文为空

网络正文可能因以下原因被省略：

| 标记 | 原因 | 下一步 |
| --- | --- | --- |
| `too-large` | 超过 `maxBodyBytes` | 在受控环境提高上限，或使用服务端日志 |
| `binary` | 非文本 MIME | 用桌面抓包或下载原始响应 |
| `streaming` | 流式正文无法安全克隆 | 检查帧/事件或服务端流日志 |
| `opaque` | `no-cors` 响应不可读 | 修正 CORS，或在服务端观察 |
| `unavailable` | WebView/API 限制 | 查看环境面板的能力探测 |

Optik 不会为了“显示点东西”而绕过浏览器同源和响应可读性边界。

## 复制退化为文本框

在局域网 HTTP、旧 WebView 或页面权限策略下，异步剪贴板可能不可用。Optik 会依次尝试同步复制、异步剪贴板，最后打开内容已全选的文本框。最后一种不是报错，而是保证内容仍可由系统菜单复制的降级路径。

## 面板样式与页面冲突

面板在 Shadow DOM 中运行，正常情况下不会被宿主 CSS 影响。如果仍有异常，请检查：

- 宿主脚本是否遍历并修改所有 Shadow Root
- 页面是否注入改变浏览器缩放或可视视口的原生桥
- WebView 是否禁用了 CSS 自定义属性、`dvh` 或 `ResizeObserver`

环境面板会显示关键 API 的支持状态。

## SSR 或 Node 导入失败

使用包入口导入，不要直接引用浏览器 IIFE：

```ts
import { mount } from 'optik-sol';

if (typeof document !== 'undefined') {
  mount();
}
```

ESM、CJS 和 IIFE 产物都可以在无 DOM 环境求值；只有调用 `mount()` 需要浏览器 document。

## 提交可复现报告

请附上：

- Optik 版本与接入方式
- 浏览器/WebView 名称和版本、操作系统与设备
- 环境面板复制文本
- 已脱敏 HAR 或最小复现页面
- 预期结果、实际结果和稳定复现步骤

不要提交原始 Cookie、Authorization、访问令牌、用户正文或生产数据库内容。
