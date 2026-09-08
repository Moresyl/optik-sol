# Privacy & Security

## Default boundaries

- No remote service and no telemetry connection
- HAR export redacts credentials and omits bodies by default
- JSON is parsed and rendered in the current page
- Request and response bodies are capped by `maxBodyBytes`
- Logs, network records, long tasks, object expansion, and tree rendering are bounded

## What still needs your judgment

Optik runs in the same JavaScript context as the page. Any script that can execute in that page may read the same data. Optik is not a security sandbox and does not replace access control, server-side auditing, or production redaction.

## Safe export checklist

Before exporting, decide whether the recipient may see URLs, headers, bodies, or device information; keep `redactSensitive: true` unless the transfer is trusted and intentional.

```ts
const safe = serializeHar(records, {
  redactSensitive: true,
  includeBodies: false,
  includeWebSocketFrames: false,
});
```

Remote transports must provide TLS, authentication, session isolation, size limits, rate limits, and replay protection. `createInProcessTransportPair()` is a message boundary, not a network security solution.
