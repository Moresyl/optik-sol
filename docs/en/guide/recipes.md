# Recipes

## Export a privacy-safe HAR

The Network panel and public API redact common credentials, URLs, query parameters, redirects, JSON fields, and form fields by default. Bodies and WebSocket frame payloads are omitted unless explicitly requested.

```ts
import { serializeHar } from 'optik-sol';

const safeHar = serializeHar(optik.kernel.network.records());
const bodyAwareHar = serializeHar(optik.kernel.network.records(), {
  includeBodies: true,
  includeWebSocketFrames: true,
});
```

Do not use `redactSensitive: false` for tickets, chat, or public issues.

## Enable only for authorized users

```ts
async function enableSupportConsole() {
  const response = await fetch('/internal/debug-session', { credentials: 'include' });
  if (!response.ok) return;

  const { mount } = await import('optik-sol');
  return mount({ defaultOpen: true, maxBodyBytes: 128 * 1024 });
}
```

The server endpoint must enforce authorization and expiration. Dynamic import keeps Optik out of the ordinary production path.

## Add a business-specific plugin

```ts
optik.use({
  id: 'account',
  label: 'Account',
  render(context) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Copy account context';
    button.addEventListener('click', () => {
      context.copy(JSON.stringify({ tenant: 'demo', role: 'tester' }, null, 2), 'Account context');
    });
    return button;
  },
});
```

Plugin nodes retain state across tab switches. Plugin failures are isolated and logged.

## Connect a transport

```ts
import {
  attachKernelProtocol,
  createInProcessTransportPair,
  KernelProtocolMethods,
  ProtocolClient,
} from 'optik-sol';

const [clientSide, kernelSide] = createInProcessTransportPair();
const server = attachKernelProtocol(optik.kernel, kernelSide);
const client = new ProtocolClient(clientSide);

const page = await client.request(KernelProtocolMethods.NetworkRecords, {
  offset: 0,
  limit: 100,
});

client.close();
server.dispose();
```

A remote transport must provide authentication, encryption, session isolation, rate limits, and replay protection. Optik never uploads captures by itself.
