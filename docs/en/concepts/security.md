# Privacy & Security

## Default boundaries

- No remote service and no telemetry connection
- HAR export redacts credentials and omits bodies by default
- JSON is parsed and rendered in the current page
- Request and response bodies are capped by `maxBodyBytes`
- The Environment panel redacts credentials, query parameters, and fragments from page URLs by default; raw URLs require an explicit action
- Network records remove URL usernames and passwords; query parameters still follow HAR redaction rules
- Copied cURL commands redact URL credentials, sensitive query parameters, sensitive request headers, and structured request-body fields by default
- Network detail copies apply the same redaction boundary to query parameters and request/response headers
- HAR text and WebSocket frame exports redact common credential key/value payloads (for example, `token=…`) by default
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
