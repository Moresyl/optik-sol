<div align="center">

# Optik Sol

**A mobile web debugging console. One `<script>` tag, no server, no runtime dependencies.**

[![npm](https://img.shields.io/npm/v/optik-sol.svg)](https://www.npmjs.com/package/optik-sol)
[![CI](https://github.com/Moresyl/optik-sol/actions/workflows/ci.yml/badge.svg)](https://github.com/Moresyl/optik-sol/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/optik-sol.svg)](LICENSE)

English | [简体中文](README.zh-CN.md)

</div>

---

Optik Sol puts a full debugging console inside any page running on a phone or in a WebView — a single file, roughly 68 KB gzipped.

```html
<script src="https://unpkg.com/optik-sol"></script>
```

Recording starts the moment the script executes. Drop it in `<head>` and there is no wait for `DOMContentLoaded`: errors and requests fired during page startup are all captured.

## Panels

| Panel | What it shows |
| --- | --- |
| **Console** | Logs at every level, groups, repeat collapsing, `%c` styling, regex search with highlighting, checkbox batch copy, expression evaluation (`$_` refers to the previous result) |
| **Network** | XHR / Fetch / sendBeacon / WebSocket / EventSource / static resources — request and response headers and bodies, timing breakdown, per-frame WebSocket records, privacy-safe HAR 1.2 export |
| **Elements** | Live, lazily expanded DOM tree, in-page picking, highlighting, box model, computed styles, selector copy |
| **Storage** | localStorage / sessionStorage / Cookie / IndexedDB, with full read-write access |
| **Environment** | Device, viewport, safe area, memory, load timing, bounded main-thread long-task evidence, capability detection |

## Design highlights

| Behaviour | Detail |
| --- | --- |
| **Copy never fails** | Three fallback layers: `execCommand` → async Clipboard API → a pre-selected textarea. The last layer depends on no API at all, so it works on non-secure origins such as `http://192.168.x.x` |
| **Copy lives at the end of every row** | Every console row has a *Copy* button (timestamp and stack included); every network row has *cURL*. They sit at a fixed x position and never drift with content length |
| **Large objects expand instantly** | Only a one-level shallow preview is produced; real objects stay behind opaque handles. A 100k-element array expands immediately, cycles are marked `[Circular]`, and getters render as `(...)` and are never invoked |
| **Long-press still selects text** | Gesture detection is `passive` throughout and never calls `preventDefault()`, so native long-press selection is left intact |
| **Laid out by mobile rules** | `100dvh`, `env(safe-area-inset-*)`, touch targets ≥ 44 px, 16 px inputs, sizes in px only — never rem |
| **Split when wide, drill down when narrow** | At a panel width ≥ 640 px the layout splits (the ratio is remembered locally); `pointer: fine` switches to compact rows, while touch keeps full row height |
| **Never leaks into the host page** | The whole panel lives in a Shadow DOM, isolated in both directions; every hook passes through to the original method, and `destroy()` restores each one from its original property descriptor |

It also captures signals that debugging tools commonly miss: resource load failures (`<img>` / `<script>` / CSS 404s — these events do not bubble), CSP violations, whether `sendBeacon` was actually accepted, EventSource streams, requests with no JavaScript API (via Resource Timing), and cache hits.

The full reasoning behind these trade-offs is in [DESIGN.md](DESIGN.md).

## Usage

### Script tag

```html
<script src="https://unpkg.com/optik-sol" data-theme="dark" data-max-logs="2000"></script>
```

| Attribute | Description |
| --- | --- |
| `data-theme` | `light` (default) / `dark` |
| `data-open` | If present, the panel starts expanded |
| `data-max-logs` | Maximum log entries, default 5000 |
| `data-max-requests` | Maximum request records, default 1000 |
| `data-max-long-tasks` | Maximum main-thread long-task records, default 200 |
| `data-optik-manual` | If present, the panel does **not** auto-mount; call `Optik.mount()` yourself |

Once mounted, `window.Optik` is available.

### Bundler

```bash
npm i optik-sol
```

```js
import { mount } from 'optik-sol';

if (import.meta.env.DEV) {
  mount();
}
```

> Do not mount unconditionally in production: the panel reads request headers, request bodies and local storage, and is reachable by any script on the page.

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
  passthrough: true,       // keep calling the native console, default true
  maxBodyBytes: 512 * 1024,
});

optik.show('network');
optik.hide();
optik.use(plugin);
optik.eject('plugin-id');
optik.destroy();           // fully restores every hook
```

The Network panel can copy a HAR 1.2 archive in safe mode: request/response bodies and
WebSocket frame payloads are omitted, while credentials in headers, URLs and query
parameters are redacted. Code can call `serializeHar(records)` and explicitly opt into
retained payloads with `{ includeBodies: true, includeWebSocketFrames: true }`; supported
JSON and form fields are then redacted too. Raw export additionally requires
`{ redactSensitive: false }`.

The Environment panel also keeps a bounded history of browser-reported main-thread
long tasks (50ms or longer), including cumulative/maximum duration and available
browsing-context attribution. Set `capture.longTasks: false` to disable collection.

### Protocol transport

The public protocol layer can expose bounded logs, network records, long tasks, system
information, and their live events to a worker or remote client. Only attach it to a
trusted or authenticated transport because captured diagnostics may contain secrets.

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

List commands are paginated and capped at 1000 items per response. Object expansions
borrow child handles from the kernel; call the matching `Log.releaseObject` or
`Network.releaseObject` command when finished. Server disposal releases every remaining
handle borrowed by that session.

### Plugins

A plugin does not need to depend on Solid — returning a plain DOM node is enough.

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

`context` exposes `kernel` / `copy` / `reveal` / `log` / `theme`.

> Panel copy is Chinese by design — see [Hard constraints](CONTRIBUTING.md#hard-constraints).

## Packages

| Package | Description |
| --- | --- |
| `optik-sol` | The only published package; both `<script>` and `import` entry points come from here |
| `optik-core` | Internal. Instrumentation, value mirroring, ring buffers. Zero dependencies, never touches the DOM |
| `optik-ui` | Internal. The panel UI: Solid + Shadow DOM + UnoCSS |

The kernel and the UI talk over CDP-shaped messages with a `Transport` layer in between. Today that transport runs in-process; swapping it for a WebSocket turns this into a remote debugger without changing a line of the kernel.

## Development

```bash
pnpm install
pnpm dev          # starts the playground; the page header shows a LAN address and QR code
pnpm typecheck
pnpm build
```

Every button in the playground maps to a scenario that is known to break debugging tools. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## Documentation

[Contributing](CONTRIBUTING.md) · [Design notes](DESIGN.md) · [Security policy](SECURITY.md) · [Code of conduct](CODE_OF_CONDUCT.md) · [Changelog](CHANGELOG.md)

## License

MIT — see [LICENSE](LICENSE).
