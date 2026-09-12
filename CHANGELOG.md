# Changelog

English | [简体中文](CHANGELOG.zh-CN.md)

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Distribution checks now smoke-test the core ESM/CJS public exports alongside the main package.
- Protocol method names reject Unicode control and formatting characters for unambiguous transport logs.

- `optik-core` now declares browser/default export conditions and the distribution gate smoke-tests its ESM/CJS public exports.
- Protocol method validation rejects non-string values and control characters; request IDs remain safe across long-lived sessions.
- Empty event-listener sets are pruned after unsubscribe to reduce retained state in long-running sessions.
- JSON tree truncation and expand-all limits are announced to assistive technologies; persisted layout storage failures degrade safely.

- Added keyboard-friendly tab navigation with roving focus, arrow/Home/End controls, and linked tab panels.
- Deep object copy now forwards the remaining node budget to property expansion and preserves truncation evidence.
- Refined the documentation theme for clearer navigation, readable code blocks, responsive spacing, and keyboard-visible focus states.
- Pinned README installation examples to the current release and refreshed Solid and happy-dom patch dependencies.
- Documented the supported browser baseline and clarified ESM/IIFE package entry points.
- Added browser/default export conditions and preserved the global IIFE side effect declaration.
- CI now audits production dependencies, validates package entry files, and checks the publish contract.
- Added matching npm installation snippets to both documentation home pages.
- Aligned SolidJS patch ranges across the UI and public package workspaces.
- Documentation now respects reduced-motion preferences and provides a consistent selection highlight.
- Added cross-section links to both documentation sidebars and navigation for comparison pages.
- Refined the documentation landing page spacing, mobile typography, action wrapping, and background treatment.
- Clarified runtime trust boundaries and the requirement to use controlled builds and trusted protocol transports in package READMEs.
- CI now cancels superseded runs for the same workflow/ref, reducing stale verification results and runner usage.
- CI jobs now have a bounded execution timeout so hung verification cannot consume runners indefinitely.
- CI now declares a least-privilege read-only repository permission.
- Stabilized tab accessibility identifiers so plugin IDs with special characters cannot produce invalid relationships.
- Plugin registration now rejects blank identifiers, and removing the active plugin safely returns to the Console tab.
- Added regression coverage for blank plugin labels as well as identifiers.
- Plugin IDs with leading or trailing whitespace are rejected to keep lookup and tab identity stable.
- Plugin labels now apply the same whitespace validation for predictable tab names.
- Expandable values now expose keyboard activation and keep non-expandable primitives out of the focus order.
- Unevaluated getters are now shown explicitly instead of being mistaken for `undefined` values.
- README design highlights now document keyboard and touch interaction guarantees.
- Added regression coverage for roving focus and arrow-key panel tab navigation.

### Fixed

- Ring-buffer eviction callbacks are isolated from host instrumentation, including `undefined` entries, so cleanup failures cannot interrupt collection.

- Deep copy no longer drops user properties whose names resemble internal slots.
- Code highlighting now keeps URL separators inside quoted strings and recognises inline comments safely.
- Added regression coverage for escaped quotes in highlighted source strings.
- CSS syntax highlighting no longer treats comment markers inside quoted strings as comments.
- UI controls now explicitly use non-submit button semantics, preventing accidental host-form submission when the console is embedded in a form.

- Copied cURL commands now redact URL credentials, sensitive query parameters, sensitive request headers, and structured request-body fields by default.
- Network detail copy now applies the same redaction boundary to query parameters and request/response headers.
- Network detail views now redact sensitive query parameters and request/response header values by default.
- Network records now remove URL username and password components before they can appear in the panel, protocol events, or HAR exports.
- HAR text and WebSocket frame exports now redact credential-like key/value payloads by default.
- Environment evidence now redacts page URL credentials, query parameters, and fragments by default, with an explicit raw URL reveal for intentional debugging.
## [0.4.1] - 2026-09-08

### Added

- A bilingual VitePress documentation site with local full-text search, structured guides, API and transport reference, architecture/security/performance concepts, troubleshooting, and an evidence-based competitor comparison

### Changed

- Added documentation build and artifact checks to CI, introduced a dedicated GitHub Pages deployment workflow, linked the new site from both READMEs, and restored browser zoom in the mobile playground

### Fixed

- HAR exports now derive their creator version from the core package metadata instead of reporting the stale `0.2.0` value

## [0.4.0] - 2026-08-27

### Added

- A shared structured-text viewer with formatted JSON tree/code modes, syntax highlighting, line numbers, wrapping controls, bounded expansion, raw-source access, and contextual copy actions

### Changed

- Applied the structured viewer across request/response bodies, WebSocket frames, console JSON strings, storage values, cURL commands, and element HTML; added bulk copy actions for query parameters, headers, attributes, and computed styles; clarified raw-source viewing separately from clipboard fallback
- Fixed the playground POST example's invalid non-Latin-1 request header and added a dedicated JSON-string scenario for visual regression testing

## [0.3.0] - 2026-08-27

### Added

- Privacy-safe HAR 1.2 export with real multipart-field redaction and explicit payload/raw-value opt-ins
- Bounded main-thread Long Tasks capture, attribution, Environment-panel diagnostics, and declarative script configuration
- A protocol client/router, isolated in-process transport, and trusted-transport kernel bridge with pagination and borrowed-object cleanup for logs, network records, performance data, and live events
- Bounded object-property expansion with an explicit truncation marker for very large arrays, maps, sets, and objects
- Case-sensitive console search alongside literal and regular-expression matching

### Changed

- Expanded enforceable coverage thresholds from core-only measurement to every shipped package, with broad edge/error/lifecycle regression tests
- Hardened instrumentation (including in-flight XHR and live WebSocket/EventSource cleanup) and transport teardown, bounded response capture with strict length validation, semantically correct log coalescing, transactional/automatic mounting, validated plugin navigation plus cleanup/subscriber/diagnostic isolation, object-handle release including replaced network bodies and exceptional deep-copy paths, stable network record identity, asynchronous clipboard/modal lifecycle and keyboard focus, network timing/body/HAR rendering, runtime buffer resizing, background-page state delivery, live element-tree selectors and self-healing highlighting, asynchronous IndexedDB enumeration, REPL evaluation/session history, keyboard-adjustable splitters, visible focus states, disconnectable legacy layout observers, and shared frame-scheduling fallbacks for incomplete WebViews
- Released per-row long-press listeners on unmount and guarded zero-duration network timing bars against invalid CSS widths
- Kept ESM, CJS, and IIFE entry points safe to evaluate in server-side and build-tool environments without a DOM

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

[Unreleased]: https://github.com/Moresyl/optik-sol/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/Moresyl/optik-sol/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/Moresyl/optik-sol/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Moresyl/optik-sol/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Moresyl/optik-sol/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Moresyl/optik-sol/releases/tag/v0.1.0
