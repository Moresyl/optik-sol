# Public API

## `mount(options?): OptikInstance`

Starts the kernel, installs instrumentation, and mounts the Shadow DOM panel. Mounting is transactional and rolls back registered resources on failure.

## `instance(): OptikInstance | null`

Returns the active instance, or `null` before mounting and after destruction.

## `OptikInstance`

| Member | Purpose |
| --- | --- |
| `kernel` | `OptikKernel` with log, network, performance, storage, and system domains |
| `show(tab?)` | Open the panel and optionally select a built-in or plugin tab |
| `hide()` | Hide UI while collection continues |
| `use(plugin)` | Register a plugin and return the instance |
| `eject(id)` | Unregister a plugin and report whether it existed |
| `destroy()` | Stop collection, release resources, and restore the host environment |

Built-in `TabId` values are `console`, `network`, `element`, `storage`, and `system`. Plugin tabs use `plugin:<id>`.

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

Streaming domains use bounded buffers and expose events. Do not retain object handles after their owning domain entry has been evicted.

## `copyText(text, label?)`

Runs the 3-stage copy fallback and returns a `CopyOutcome` describing synchronous, async, or manual completion.

## HAR

```ts
createHar(records, options): HarArchive
serializeHar(records, options): string
```

Defaults are `redactSensitive: true`, `includeBodies: false`, and `includeWebSocketFrames: false`. See [Privacy & Security](/en/concepts/security).

## Plugins

`OptikPlugin` defines `id`, `label`, `render()`, and optional `onShow`, `onHide`, `onDispose`, and `badge` hooks. `PluginContext` provides `kernel`, `copy`, `reveal`, `log`, and the reactive `theme`.

## Protocol exports

`ProtocolClient`, `ProtocolRouter`, `attachKernelProtocol`, `createInProcessTransportPair`, `KernelProtocolMethods`, and protocol message types are exported from the package root. See [Protocol & Transport](/en/reference/protocol).
