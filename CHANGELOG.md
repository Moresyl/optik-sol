# 更新日志

本文件记录值得使用者关注的变更。格式参考
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

## [0.1.0]

首个版本。

### 新增

- **控制台**：各级别日志、分组、重复合并、`%c` 样式、正则搜索与命中高亮、
  勾选批量复制、表达式求值（`$_` 引用上次结果）
- **网络**：XHR / Fetch / sendBeacon / WebSocket / EventSource / 静态资源，
  请求响应头与体、DNS·TCP·TLS·等待·下载分段耗时、WebSocket 逐帧记录
- **元素**：DOM 树惰性浏览、页面内拾取、高亮、盒模型、计算样式、复制选择器
- **存储**：localStorage / sessionStorage / Cookie / IndexedDB 的增删改查
- **环境**：设备、视口、安全区、内存、加载时序、能力探测
- **每行行尾常驻复制列**：控制台复制整行（含时间戳与调用栈），网络复制 cURL 命令。
  位置固定在同一个 x 上，不随内容长短漂移
- **三层降级的复制策略**：`execCommand` → 异步剪贴板接口 → 全选文本框兜底。
  最后一层不依赖任何 API，在 `http://192.168.x.x` 这类非安全上下文下同样可用
- **惰性值镜像**：只做一层浅预览，真实对象由不透明句柄引用。十万元素数组即时展开，
  循环引用标注 `[Circular]`，带 getter 的对象显示 `(...)` 且绝不触发求值
- **响应式布局**：面板宽度 ≥ 640px 分栏（比例记在本地），`pointer: fine` 下切紧凑排版，
  触屏下所有行不低于 44px
- **插件机制**：`use()` / `eject()`，插件返回原生 DOM 节点即可，不需要依赖 Solid
- **完整还原**：`destroy()` 按原始属性描述符逐一还原所有插桩
- 产物三份：ESM、CJS、单文件 IIFE（gzip 约 46 KB）

[未发布]: https://github.com/zhanghaidong/optik/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/zhanghaidong/optik/releases/tag/v0.1.0
