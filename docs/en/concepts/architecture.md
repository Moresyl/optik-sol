# Architecture

Optik has three explicit boundaries:

```text
Debugged page
  ├─ instrumentation (native API hooks)
  ├─ OptikKernel (bounded domains)
  ├─ Transport (CDP-shaped messages)
  └─ Shadow DOM UI / plugins (replaceable views)
```

The instrumentation layer saves original descriptors, forwards native behavior, isolates diagnostic failures, and restores every hook during `dispose()`. Domains keep logs, network records, long tasks, and lazy object handles behind explicit bounds. The kernel does not depend on the DOM and can be reused by Workers, Node tests, or a remote service.

The protocol uses CDP-shaped `Request`, `Response`, and `Event` messages. The built-in transport is in-process today; a WebSocket, MessagePort, or native bridge can be added at the boundary without rewriting collection or UI.

The Solid UI mounts inside Shadow DOM. Host resets and component-library styles do not leak in, and Optik styles do not mutate the product page. Narrow screens use drill-in navigation; wide panels use a resizable split view with safe-area and touch-target guarantees.
