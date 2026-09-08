# 公开 API

## `mount(options?): OptikInstance`

启动内核、安装采集器并挂载 Shadow DOM 面板。挂载是事务式的；失败时会回滚已注册资源。

## `instance(): OptikInstance | null`

返回当前实例。尚未挂载或已销毁时返回 `null`。

## `OptikInstance`

| 成员 | 说明 |
| --- | --- |
| `kernel` | `OptikKernel` 实例，提供日志、网络、性能、存储和系统域 |
| `show(tab?)` | 打开面板，可切换到内置或插件标签 |
| `hide()` | 隐藏面板但继续采集 |
| `use(plugin)` | 注册插件并返回当前实例 |
| `eject(id)` | 注销插件；存在时返回 `true` |
| `destroy()` | 停止采集、释放资源、还原宿主环境 |

内置 `TabId`：`console`、`network`、`element`、`storage`、`system`。插件标签使用 `plugin:<id>`。

## `OptikKernel`

```ts
const kernel = optik.kernel;

kernel.log.entries();
kernel.network.records();
kernel.performance.longTasks();
kernel.storage.snapshot('localStorage');
kernel.system.info();
kernel.evaluate('document.title');
```

每个流式域都使用有上限的缓冲并暴露事件。不要长期保留已经从域中淘汰的对象句柄。

## `copyText(text, label?)`

执行三层剪贴板降级并返回结果：

```ts
type CopyOutcome =
  | { ok: true; method: 'execCommand' | 'clipboard' }
  | { ok: false; method: 'manual'; text: string; label: string };
```

## HAR

```ts
createHar(records, options): HarArchive
serializeHar(records, options): string
```

默认值是 `redactSensitive: true`、`includeBodies: false`、`includeWebSocketFrames: false`。详见[隐私与安全](/concepts/security)。

## 插件

```ts
interface OptikPlugin {
  id: string;
  label: string;
  render(context: PluginContext): Node | (() => Node);
  onShow?(context: PluginContext): void;
  onHide?(context: PluginContext): void;
  onDispose?(context: PluginContext): void;
  badge?(): number | undefined;
}
```

`PluginContext` 提供 `kernel`、`copy`、`reveal`、`log` 和响应式 `theme`。

## 协议导出

`ProtocolClient`、`ProtocolRouter`、`attachKernelProtocol`、`createInProcessTransportPair`、`KernelProtocolMethods` 和协议消息类型从包根导出。完整约束见[协议与传输](/reference/protocol)。
