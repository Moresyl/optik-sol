# optik-core

The instrumentation kernel of [Optik Sol](https://github.com/Moresyl/optik-sol): it collects console output, errors, network activity, storage state and system information. Zero dependencies, never touches the DOM.

**Internal package, not published on its own.** Install [`optik-sol`](https://www.npmjs.com/package/optik-sol) instead.

## Scope

- Captures console, exception, Fetch/XHR, WebSocket/SSE, resource timing, storage, DOM and long-task evidence.
- Keeps records bounded with ring buffers, body/frame byte limits, paged protocol reads and lazy object handles.
- Exposes a CDP-shaped protocol for the UI or a trusted custom transport.

The kernel is browser-only at runtime for instrumentation, but its ESM/CJS module can be imported in Node for SSR-safe composition. It does not provide a remote collector, authentication boundary, or data sanitisation guarantee for arbitrary custom consumers; apply an explicit capture policy before exporting evidence.

> [Optik Sol](https://github.com/Moresyl/optik-sol) 的插桩内核，零依赖、不碰 DOM。内部包，不单独发布，请安装 [`optik-sol`](https://www.npmjs.com/package/optik-sol)。

MIT
