# 架构

Optik 由三个边界清晰的层组成：

```text
被调试页面
  ├─ instrumentation（原生 API 插桩）
  ├─ OptikKernel（有界领域模型）
  ├─ Transport（CDP 形状消息）
  └─ Shadow DOM UI / plugin（可替换视图）
```

## 插桩层

内核在 `start()` 时保存原始属性描述符并安装包装器。包装器始终：

- 先写入 Optik 领域，再透传原方法
- 拦截页面异常，不向宿主脚本抛出诊断器异常
- 对重复挂载和重入保持幂等
- 在 `dispose()` 中按原始描述符还原

这让诊断工具成为页面的旁观者，而不是新的行为变量。

## 领域层

日志、网络和长任务都是独立的有界流。对象值只保存一层预览，其余部分由 `ObjectRegistry` 通过句柄惰性展开；条目淘汰时同步释放句柄。领域层不依赖 DOM，可在 Worker、Node 测试和远程服务中复用。

## 协议层

内核消息采用 CDP 形状：`Request`、`Response`、`Event`。当前内置 transport 在进程内运行，但客户端与服务端之间没有 UI 依赖；未来接 WebSocket、MessagePort 或原生桥时，只需实现传输边界。

## UI 层

Solid UI 被挂进独立 Shadow Root。宿主页面的 reset、组件库和 `!important` 不会穿透；面板的 CSS 也不会改变业务页面。窄屏采用钻入式详情，宽屏才启用可拖拽分栏；所有触控目标不小于 44px，并保留安全区。

## 为什么不直接上传数据

本地页面已经拥有最完整的上下文，上传会增加凭据泄露、跨网和合规风险。Optik 因此默认只在当前页面内展示；只有使用者主动绑定可信且已认证的 transport，数据才会越过进程边界。
