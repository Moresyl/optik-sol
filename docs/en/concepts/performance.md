# Performance Boundaries

Optik is designed to collect useful evidence without becoming the incident.

| Resource | Default bound | Why |
| --- | ---: | --- |
| Logs | 5,000 entries | Predictable memory in long sessions |
| Network records | 1,000 entries | Bound waterfall and body retention |
| Long tasks | 200 entries | Keep evidence without polling the event loop |
| One body | 512 KiB | Avoid blocking on large clones |
| JSON parsing | 1 MiB | Keep the debugger from stalling the page |
| Expand all | 500 nodes / 12 levels | Bound DOM and recursion |

Objects are shallow-mirrored at capture time and expanded only on demand. Lists use ring buffers and pagination; structured code renders by page. Closing the panel disconnects layout observers so detached DOM is not retained.

When measuring page performance, compare identical “unmounted” and “mounted” configurations. The debugger adds some serialization, DOM, and observer work; it is evidence tooling, not a production performance baseline.
