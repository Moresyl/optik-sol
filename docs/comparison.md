# 能力对比

这张表只比较公开文档与当前代码可以验证的能力，不把路线图写成已完成。基线核对日期：**2026-09-08**。

| 能力 | Optik Sol 0.4 | Eruda | vConsole | PageSpy |
| --- | :---: | :---: | :---: | :---: |
| 单脚本页内调试 | ✓ | ✓ | ✓ | 客户端接入 |
| 零服务端运行 | ✓ | ✓ | ✓ | — |
| 控制台 / 网络 / 元素 / 存储 | ✓ | ✓ | ✓ | ✓ |
| Fetch / XHR / Beacon | ✓ | ✓ | ✓ | ✓ |
| WebSocket / SSE 帧 | ✓ | 部分 | WebSocket | ✓ |
| 非 JS 资源与缓存命中 | ✓ | 有资源面板 | — | ✓ |
| JSON 树 + 代码双视图 | ✓ | 文本/对象查看 | 格式化 JSON | ✓ |
| 隐私安全 HAR 1.2 | 默认脱敏、正文显式加入 | — | — | 网络导出场景不同 |
| 主线程 Long Tasks | 有界记录与归因 | — | 性能信息 | 性能面板 |
| CDP 形状公开协议 | ✓ | 借助 Chobitsu | — | 远程协议 |
| 完整远程调试服务 | 可扩展传输，未内置服务 | Chii 另项目 | — | ✓ |
| Shadow DOM 样式隔离 | ✓ | — | — | 调试端独立页面 |
| 无 DOM ESM/CJS/IIFE 求值 | ✓ | 未声明 | 未声明 | 不适用 |

## Optik 的明确优势

- **隐私默认值**：HAR 在导出前就执行字段级脱敏，正文和 WebSocket 载荷需要分别显式开启。
- **有界数据模型**：正文、日志、网络、长任务、对象展开和 JSON 渲染都有限制，而不是把上限交给设备内存。
- **WebView 交互可靠性**：非 HTTPS 复制、动态视口、安全区、触控目标、长按选词和 API 缺失均有专门路径。
- **可替换后端边界**：本地面板与协议客户端使用同一领域模型，为 Worker、原生桥与可信远程 transport 留出稳定接口。

## 仍需继续建设

- PageSpy 已提供完整的远程房间、服务端部署和跨设备调试闭环；Optik 当前只提供 transport 抽象，不宣称已具备同等远程服务。
- Eruda 拥有成熟插件生态与 Sources 等更广工具面；Optik 当前优先保证移动端证据质量与可恢复性。
- 真机兼容矩阵需要持续扩大，尤其是较旧的 Android System WebView、微信内置浏览器和 iOS WKWebView。

## 参考基线

- [Eruda 官方仓库](https://github.com/liriliri/eruda)
- [vConsole 官方仓库](https://github.com/Tencent/vConsole)
- [PageSpy 官方仓库](https://github.com/HuolalaTech/PageSpy)

这份对比用于选择工程优先级，不构成对其他项目质量或适用场景的绝对评价。
