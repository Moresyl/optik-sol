# optik-ui

The panel UI of [Optik Sol](https://github.com/Moresyl/optik-sol): Solid + Shadow DOM + UnoCSS, tuned for touch debugging on real devices and in WebViews.

**Internal package, not published on its own.** Install [`optik-sol`](https://www.npmjs.com/package/optik-sol) instead.

## Scope

- Renders the touch-friendly Shadow DOM console used by `optik-sol`.
- Provides searchable logs, request details, structured JSON tree/code views, syntax highlighting, copy/reveal sheets, storage editing, and system diagnostics.
- Preserves host-page styles through isolation and degrades when clipboard, `dvh`, or optional browser APIs are unavailable.

This package is an implementation layer rather than a standalone product API. Its components expect the core protocol and should be consumed through `optik-sol` so lifecycle cleanup, privacy defaults, and version compatibility stay aligned.

> [Optik Sol](https://github.com/Moresyl/optik-sol) 的面板 UI：Solid + Shadow DOM + UnoCSS。内部包，不单独发布，请安装 [`optik-sol`](https://www.npmjs.com/package/optik-sol)。

MIT
