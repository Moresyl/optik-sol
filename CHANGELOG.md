# Changelog

English | [简体中文](CHANGELOG.zh-CN.md)

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Privacy-safe HAR 1.2 export with real multipart-field redaction and explicit payload/raw-value opt-ins
- Bounded main-thread Long Tasks capture, attribution, Environment-panel diagnostics, and declarative script configuration
- A protocol client/router, isolated in-process transport, and trusted-transport kernel bridge with pagination and borrowed-object cleanup for logs, network records, performance data, and live events
- Bounded object-property expansion with an explicit truncation marker for very large arrays, maps, sets, and objects

### Changed

- Added enforceable coverage thresholds and broad edge/error/lifecycle regression tests
- Hardened instrumentation (including in-flight XHR and live WebSocket/EventSource cleanup) and transport teardown, bounded response capture with strict length validation, semantically correct log coalescing, transactional/automatic mounting, plugin cleanup and subscriber isolation, object-handle release including replaced network bodies, stable network record identity, asynchronous clipboard/modal lifecycle and keyboard focus, runtime buffer resizing, background-page state delivery, live element-tree selectors and self-healing highlighting, asynchronous IndexedDB enumeration, REPL evaluation/session history, keyboard-adjustable splitters, visible focus states, and disconnectable legacy layout observers

## [0.2.0] - 2026-08-11

### Added

- **Console**: a palette of common debugging commands, auto-expansion of expression results, structured browsing of JSON strings, deep copy of objects, and batch copy of selected logs
- **Network**: broader request-type detection, status statistics and richer detail views, formatting of request and response payloads, a timing breakdown, and more complete copy output
- **Storage**: JSON-formatted editing, entry expansion, quota display, one-click export, and confirmation for destructive actions
- **Object viewer**: lazy expansion scoped to the owning data domain, with correct lifetime management for temporary object handles

### Changed

- Reworked panel layout, touch target sizing, tab navigation, copy feedback, and the information hierarchy of every page
- Enriched element style grouping, system environment details, and network connection information
- Light theme is now the default; the panel no longer follows the host system theme automatically
- Hardened behaviour in hostile environments, covering cross-origin responses, browser capability probing, and stack collection

## [0.1.0]

First release.

### Added

- **Console**: logs at every level, groups, repeat collapsing, `%c` styling, regex search with match highlighting, checkbox batch copy, expression evaluation (`$_` refers to the previous result)
- **Network**: XHR / Fetch / sendBeacon / WebSocket / EventSource / static resources, request and response headers and bodies, DNS · TCP · TLS · waiting · download timing breakdown, per-frame WebSocket records
- **Elements**: lazy DOM tree browsing, in-page picking, highlighting, box model, computed styles, selector copy
- **Storage**: full read-write access to localStorage / sessionStorage / Cookie / IndexedDB
- **A persistent copy column at the end of every row**: the console copies the whole row (timestamp and stack included), the network copies a cURL command. Both sit at a fixed x position and never drift with content length
- **Three-layer copy fallback**: `execCommand` → async Clipboard API → pre-selected textarea. The last layer depends on no API and works on non-secure origins such as `http://192.168.x.x`
- **Lazy value mirroring**: only a one-level shallow preview, with real objects behind opaque handles. A 100k-element array expands instantly, cycles are marked `[Circular]`, and objects with getters render as `(...)` and are never evaluated
- **Responsive layout**: the panel splits at a width ≥ 640 px (ratio stored locally), `pointer: fine` switches to compact rows, and touch keeps every row at ≥ 44 px
- **Plugin system**: `use()` / `eject()`; a plugin returns a plain DOM node and needs no dependency on Solid
- **Full restoration**: `destroy()` restores every hook from its original property descriptor
- Three build outputs: ESM, CJS, and a single-file IIFE (~46 KB gzipped)

[Unreleased]: https://github.com/Moresyl/optik-sol/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Moresyl/optik-sol/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Moresyl/optik-sol/releases/tag/v0.1.0
