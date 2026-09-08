# Configuration

## `mount(options)`

```ts
const optik = mount({
  theme: 'light',
  defaultOpen: false,
  defaultTab: 'console',
  log: { maxEntries: 1000 },
  network: { maxRecords: 300 },
  performance: { maxLongTasks: 200 },
  maxBodyBytes: 512 * 1024,
  passthrough: true,
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
});
```

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `container` | `HTMLElement` | `document.body` | Insertion point for the Shadow DOM host |
| `theme` | `'light' \| 'dark'` | `'light'` | Initial theme |
| `defaultOpen` | `boolean` | `false` | Open immediately after mounting |
| `defaultTab` | `TabId` | `'console'` | Initial built-in or plugin tab |
| `plugins` | `OptikPlugin[]` | `[]` | Plugins registered during startup |
| `log.maxEntries` | `number` | `5000` | Bounded log capacity |
| `network.maxRecords` | `number` | `1000` | Bounded network-record capacity |
| `performance.maxLongTasks` | `number` | `200` | Bounded long-task capacity |
| `maxBodyBytes` | `number` | `524288` | Retained bytes for each request or response body |
| `passthrough` | `boolean` | `true` | Forward calls to the native `console` |

Capacities must be finite values from `1` through `1,000,000`. Runtime resizing truncates retained data to the new bound.

## Capture switches

Every `capture` field is enabled by default. A log-only setup can disable network and performance collection:

```ts
mount({
  capture: {
    xhr: false,
    fetch: false,
    beacon: false,
    websocket: false,
    eventSource: false,
    resourceTiming: false,
    longTasks: false,
  },
});
```

::: tip Resource Timing covers requests without a JavaScript API call
Images, stylesheets, and fonts enter the Network panel through Resource Timing. Disabling it removes those requests and cache-hit evidence.
:::

## Script attributes

| Attribute | Example | Purpose |
| --- | --- | --- |
| `data-theme` | `data-theme="dark"` | Initial theme |
| `data-open` | `data-open` | Open by default |
| `data-max-logs` | `data-max-logs="2000"` | Log capacity |
| `data-max-requests` | `data-max-requests="500"` | Network-record capacity |
| `data-max-long-tasks` | `data-max-long-tasks="100"` | Long-task capacity |
| `data-optik-manual` | `data-optik-manual` | Disable IIFE auto-mounting |

Invalid or out-of-range values are ignored.

## Lifecycle

```ts
const optik = mount();

optik.show();
optik.show('storage');
optik.hide();
optik.destroy();
```

If a plugin or renderer fails during mounting, `mount()` transactionally rolls back installed instrumentation and DOM state.
