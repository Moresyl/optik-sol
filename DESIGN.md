# Design Notes

English | [简体中文](DESIGN.zh-CN.md)

The README covers *what* Optik Sol is; this document covers *why it is built this way*. Every entry below maps to a concrete failure observed on a real device.

## Copy

Real-device debugging usually happens on an address like `http://192.168.x.x:5173`, and **browsers only expose the Clipboard API on secure origins** — `navigator.clipboard` is missing in exactly the scenario that needs it most.

So copying degrades through three layers:

1. `document.execCommand('copy')`, executed synchronously to preserve the user gesture
2. The async Clipboard API, when available
3. Both failed → show a **textarea with its content already selected**, so the user can long-press and pick *Copy*

The third layer depends on no API at all; it is physically incapable of failing.

The first layer has a trap: inside a Shadow DOM, `execCommand('copy')` reads the *document* selection, which cannot see shadow content. The temporary input must therefore live in the light DOM, have real dimensions, not be `readonly`, use a 16 px font size, and set both a `Range` and `setSelectionRange`. Miss any one of these and it breaks.

## Where the copy action lives

Copying is the reason this tool exists, so it must not hide behind any layer of navigation. In the console and network lists, **every row carries a button at its trailing edge**, pinned to the same x position so a whole column can be scanned without moving your hand.

- On touch this column is 44 px wide; with a mouse it narrows to 40 px to give content room
- Console buttons are **top-aligned** — one error with an expanded stack can be a dozen lines tall, and a vertically centred button would drift out of reach, though the hit area still covers the whole row
- WebSocket rows get no cURL: curl's support for `ws://` is experimental, and handing out a command that is guaranteed to fail is worse than handing out nothing. The slot is still occupied, so the column stays aligned

Auto-follow pauses while you scroll back through history, and a *↓ Latest* affordance appears in the bottom-right corner. It does not exist while you are pinned to the bottom — a permanent row of jump buttons would tax every session for an occasional need.

## Long-press text selection

```css
user-select: text;
-webkit-user-select: text;
-webkit-touch-callout: default;
```

Three lines of CSS — but only if **gesture handlers never call `preventDefault()` on `touchstart`**, which would kill native long-press selection outright. Long-press detection is therefore purely observational: `passive` throughout, never calling `preventDefault`. It adds capability on top of native behaviour instead of replacing it.

## Value mirroring

When a log is produced, only a **one-level shallow preview** is built. Real objects stay in a registry behind opaque handles, and a level is read only when the user opens it.

| Case | Result |
| --- | --- |
| Circular references | Marked `[Circular]`, no stack overflow |
| 100k-element array | Expands instantly, main thread never blocks |
| `Map` / `Set` | Expanded as `[[Entries]]` |
| Function / `Symbol` / `BigInt` | Shown faithfully, never dropped |
| DOM nodes | Rendered as nodes, not `{}` |
| Objects with getters | Shown as `(...)`, **never evaluated** |
| Cross-iframe objects | Identified correctly (no reliance on `instanceof`) |

Handle lifetime is bound to the ring buffer: when a log is evicted, the objects it referenced are released with it. Memory has an upper bound, so leaving the panel open for hours does not degrade the page.

## Layout

- **`100dvh`, not `100vh`.** On iOS, `100vh` includes the collapsible address bar; with `vh` the action bar at the bottom of the panel ends up permanently covered and unreachable
- Every edge respects `env(safe-area-inset-*)`
- Touch targets are never smaller than 44 px (Apple HIG)
- Inputs use a **16 px** font size — below that, Safari force-zooms the entire page on focus
- Sizes are **always in px, never rem**. Mobile projects routinely use flexible.js or postcss-pxtorem to set `html { font-size }` to something like 37.5 px, and `rem` inside a Shadow DOM still resolves against the root element — a rem-based panel injected into such a page comes out deformed

## Two axes of responsiveness

Width and pointer type are evaluated **separately**, because they genuinely occur separately:

- **Width** decides whether the layout splits. At ≥ 640 px the list sits on the left and details on the right, with a draggable divider whose ratio is stored locally; narrow screens keep the drill-down flow, since forcing a split at 390 px makes both sides unreadable
- **Pointer type** decides row height. A landscape phone can be 932 px wide — wide enough to split — but the input device is still a finger, so compact rows are gated on `pointer: fine` and touch keeps every row at ≥ 44 px

What is measured is **the panel's own width**, not the viewport, via `ResizeObserver`. When the layout is split and an item is selected, the left column also drops its *type / size / duration* columns, otherwise names are squeezed down to a few characters.

## Isolation and restoration

The whole panel lives in a Shadow DOM, isolated in both directions: the host page's global resets, `!important` rules and UI-library styles cannot get in, and not one byte of our styling leaks out. A page under debugging should not change appearance because a debugger was attached — otherwise debugging becomes a new variable.

Every hook is **fully reversible**: it always passes through to the original method, guards against re-entry, never throws into the host, and is restored from its original property descriptor on `destroy()`.

## Capability detection

Some panel behaviour degrades with the environment — no Clipboard API outside HTTPS, no local storage in private mode. The *Environment* tab states these conclusions outright, so when a feature does not work the user knows why instead of suspecting the tool is broken.

## Main-thread stalls

Polling the event loop with a timer keeps the page awake and can itself distort the
performance being measured. When available, Optik therefore uses the browser's Long
Tasks API with buffered observation: tasks of at least 50ms that happened before or
after mounting enter a bounded ring buffer. The Environment panel shows retained count,
cumulative duration, maximum duration, and browsing-context attribution. Attribution
URLs are stripped of credentials, query parameters, and fragments before copying.

## What others usually do not capture

- **Resource load failures** (`<img>` / `<script>` / CSS 404s). These error events **do not bubble**; only the capture phase sees them
- **CSP violation reports**
- **Whether `sendBeacon` was actually accepted** — recording the call without reporting the browser's answer is the same as not recording it
- **EventSource (SSE)**
- **Requests with no JavaScript API** (images, fonts, CSS), captured through Resource Timing
- **Cache-hit markers** (`transferSize === 0 && decodedBodySize > 0`)

## The kernel/UI boundary

Core exposes **CDP-shaped** (Chrome DevTools Protocol) messages: `Request {id, method, params}` / `Response {id, result|error}` / `Event {method, params}`, with a `Transport` abstraction in between. The built-in UI uses the same domain facade directly to avoid serializing high-frequency local events; `attachKernelProtocol()` binds that facade to a trusted transport for remote or worker clients.

Today that layer runs in-process. Swap it for a WebSocket and you have remote debugging,
without changing the domain APIs. Core instrumentation may use browser APIs (and the
system domain briefly measures a safe-area probe), but it never owns or renders panel UI.
