---
layout: home

hero:
  name: Optik Sol
  text: Turn mobile failures into copyable evidence
  tagline: One script, no server, and no runtime dependencies. Diagnose logs, traffic, DOM, storage, and performance inside mobile browsers and WebViews.
  image:
    src: /optik-mark.svg
    alt: Optik Sol geometric lens mark
  actions:
    - theme: brand
      text: Start in 5 minutes
      link: /en/guide/getting-started
    - theme: alt
      text: Compare capabilities
      link: /en/comparison
    - theme: alt
      text: GitHub
      link: https://github.com/Moresyl/optik-sol

features:
  - icon: ◈
    title: A debugging loop, not a log viewer
    details: Capture console output, exceptions, XHR, Fetch, Beacon, WebSocket, SSE, resource timing, DOM, storage, and main-thread long tasks.
  - icon: ⌘
    title: Structured, searchable, copyable
    details: JSON tree and code views, syntax highlighting, line numbers, folding, bulk copy, cURL, and privacy-safe HAR 1.2 export.
  - icon: ⛨
    title: Sensitive data protected by default
    details: HAR export omits bodies and redacts credentials by default. Data stays in-page unless you explicitly attach a trusted transport.
  - icon: ⇄
    title: Built for real WebViews
    details: Shadow DOM isolation, 100dvh, safe areas, 44px touch targets, non-HTTPS copy fallback, and incomplete-API resilience.
  - icon: ◫
    title: Bounded under heavy load
    details: Ring buffers, lazy object handles, bounded tree expansion, and capped body capture prevent unbounded growth.
  - icon: ⟷
    title: Extensible protocol core
    details: A CDP-shaped protocol separates collection from UI and can back Workers, WebSockets, or custom plugins.
---

## Start with one line

```html
<script src="https://unpkg.com/optik-sol@0.4.1"></script>
```

Collection starts as soon as the script executes. Tap **Optik** in the bottom-right corner to open the panel. Continue with [Getting Started](/en/guide/getting-started) for bundlers, controlled mounting, and production-safe patterns.

::: warning Enable only in controlled environments
Optik can read request headers, request bodies, and page storage. Do not mount it unconditionally on untrusted pages or in builds served to every production user.
:::
