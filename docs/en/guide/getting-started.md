# Getting Started

Optik Sol is an embedded developer tool for mobile pages. It needs no proxy server, USB connection, or browser extension, making it useful for failures that reproduce only in mobile browsers, enterprise WebViews, WeChat, or in-app browsers.

## Requirements

- A modern mobile browser or WebView; capabilities degrade through feature detection
- Node.js 20 or newer for npm-based integration
- A CSP that allows the script source

## Option 1: Load from a CDN

Pin the version so the debugging environment remains reproducible:

```html
<script
  src="https://unpkg.com/optik-sol@0.4.1"
  data-theme="light"
  data-max-logs="2000"
  data-max-requests="500"
></script>
```

Instrumentation starts when the script executes. It does not wait for `DOMContentLoaded`, so placing it in `<head>` still preserves startup exceptions and requests.

## Option 2: Mount through npm

```bash
npm install optik-sol@0.4.1
```

```ts
import { mount } from 'optik-sol';

const optik = import.meta.env.DEV
  ? mount({ defaultOpen: false, theme: 'light' })
  : undefined;

optik?.show('network');
optik?.destroy();
```

Repeated `mount()` calls reuse the active instance instead of stacking panels.

## Option 3: Load first, mount later

```html
<script
  src="https://unpkg.com/optik-sol@0.4.1"
  data-optik-manual
></script>
<script>
  if (new URL(location.href).searchParams.get('debug') === '1') {
    window.Optik.mount({ defaultOpen: true });
  }
</script>
```

::: danger A query parameter is not production authentication
The `debug=1` example is for local demonstrations. Use a server-issued, short-lived authorization or include Optik only in internal builds.
:::

## Verify the integration

1. In **Console**, run `console.log({ ready: true })` and expand the object.
2. In **Network**, send a Fetch request and inspect timing, bodies, and cURL.
3. In **Environment**, review capability detection for the current WebView.
4. Call `Optik.instance()?.destroy()` and confirm the launcher disappears and native hooks are restored.

## Next steps

- Tune limits and capture switches in [Configuration](/en/guide/configuration).
- Export a safe HAR or attach plugins and transports with [Recipes](/en/guide/recipes).
- Diagnose missing bodies, copy fallbacks, or WebView differences in [Troubleshooting](/en/guide/troubleshooting).
