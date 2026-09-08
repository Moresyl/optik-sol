# Troubleshooting

## The launcher does not appear

1. Check for `[optik] automatic mount failed` in the native console.
2. A script with `data-optik-manual` requires `Optik.mount()`.
3. Verify that CSP allows the CDN or self-hosted script.
4. Confirm that the page does not remove Optik's host node during startup.

## A request exists but its body is empty

| Marker | Cause | Next step |
| --- | --- | --- |
| `too-large` | Body exceeds `maxBodyBytes` | Raise the bound in a controlled build or use server logs |
| `binary` | Non-text MIME | Download the response or use desktop traffic tooling |
| `streaming` | A stream cannot be cloned safely | Inspect frames, events, or server-side stream logs |
| `opaque` | A `no-cors` response is unreadable | Correct CORS or observe on the server |
| `unavailable` | WebView or API limitation | Review capability detection in Environment |

Optik does not bypass browser origin and response-readability boundaries just to display placeholder data.

## Copy opens a text area

Async clipboard access can be unavailable on LAN HTTP, older WebViews, or restricted pages. Optik tries synchronous copy, async clipboard access, and finally a pre-selected text area. The final path is a functional fallback, not a data-loss error.

## Panel styles conflict with the page

The panel runs inside Shadow DOM. If styling still breaks, check whether the host app mutates every Shadow Root, a native bridge changes viewport scaling, or the WebView lacks CSS custom properties, `dvh`, or `ResizeObserver`. The Environment panel reports key capabilities.

## SSR or Node import fails

```ts
import { mount } from 'optik-sol';

if (typeof document !== 'undefined') {
  mount();
}
```

ESM, CJS, and IIFE builds evaluate without a DOM. Calling `mount()` requires a browser document.

## File a reproducible report

Include the Optik version and integration mode, browser or WebView version, OS and device, copied Environment evidence, a redacted HAR or minimal reproduction, and exact expected/actual steps. Never attach raw cookies, authorization headers, access tokens, user payloads, or production data.
