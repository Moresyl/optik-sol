# Protocol & Transport

## Message model

```ts
type Request = { id: number; method: string; params?: unknown };
type SuccessResponse = { id: number; result: unknown };
type ErrorResponse = { id: number; error: ProtocolError };
type Event = { method: string; params?: unknown };
```

`ProtocolClient` owns request IDs, timeouts, cancellation, and response matching. `ProtocolRouter` owns method registration, parameter validation, exception normalization, and event delivery.

`KernelProtocolMethods` covers query, clear, expansion, and release operations for the log, network, performance, and system domains. List methods accept `offset` and `limit`, with at most 1,000 records per page.

```ts
const result = await client.request(KernelProtocolMethods.LogEntries, {
  offset: 0,
  limit: 100,
});
```

Expanded log and network values can return borrowed object handles. Release them with the matching `Log.releaseObject` or `Network.releaseObject` method. Session disposal releases any remaining borrows.

A `Transport` must preserve message order, return removable listeners, reject sends after closure, and allow either side to close without retaining listeners. A remote transport must additionally provide authentication, encryption, message-size limits, heartbeats, reconnection policy, and replay protection.

Protocol errors use stable `ErrorCode` values and safe messages. Clients should branch on codes instead of localized message text.
