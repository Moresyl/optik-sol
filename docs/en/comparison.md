# Capability Comparison

This table includes only capabilities supported by public documentation and current code. It does not present roadmap items as shipped. Baseline checked on **2026-09-08**.

| Capability | Optik Sol 0.4 | Eruda | vConsole | PageSpy |
| --- | :---: | :---: | :---: | :---: |
| Single-script in-page debugging | ✓ | ✓ | ✓ | Client integration |
| Serverless operation | ✓ | ✓ | ✓ | — |
| Console / Network / Elements / Storage | ✓ | ✓ | ✓ | ✓ |
| Fetch / XHR / Beacon | ✓ | ✓ | ✓ | ✓ |
| WebSocket / SSE frames | ✓ | Partial | WebSocket | ✓ |
| Non-JS resources and cache hits | ✓ | Resource panel | — | ✓ |
| JSON tree and code views | ✓ | Text/object views | Formatted JSON | ✓ |
| Privacy-safe HAR 1.2 | Redacted by default | — | — | Different export workflow |
| Main-thread Long Tasks | Bounded evidence | — | Performance info | Performance panel |
| Public CDP-shaped protocol | ✓ | Via Chobitsu | — | Remote protocol |
| Complete remote-debug service | Extensible transport only | Separate Chii project | — | ✓ |
| Shadow DOM style isolation | ✓ | — | — | Separate debugger page |
| DOM-free ESM/CJS/IIFE evaluation | ✓ | Not documented | Not documented | Not applicable |

## Clear Optik strengths

- HAR is redacted before export, while bodies and WebSocket payloads require separate opt-ins.
- Bodies, logs, requests, long tasks, object expansion, and JSON rendering all have explicit bounds.
- Non-HTTPS copy, dynamic viewport units, safe areas, touch targets, text selection, and missing APIs have dedicated WebView paths.
- The in-page panel and protocol clients share one domain model, creating a stable boundary for Workers, native bridges, and trusted remote transports.

## Work that remains

PageSpy already ships a complete remote-room and server deployment loop; Optik exposes a transport abstraction but does not claim an equivalent hosted system. Eruda has a mature plugin ecosystem and a wider tool surface such as Sources. Optik also needs a broader real-device matrix, especially older Android System WebView, WeChat, and iOS WKWebView versions.

Sources: [Eruda](https://github.com/liriliri/eruda), [vConsole](https://github.com/Tencent/vConsole), and [PageSpy](https://github.com/HuolalaTech/PageSpy).
