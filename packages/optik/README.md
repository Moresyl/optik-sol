# optik-sol

A mobile web debugging console. One `<script>` tag, no server, no runtime dependencies.

English | [简体中文](https://github.com/Moresyl/optik-sol/blob/main/README.zh-CN.md)

```html
<script src="https://unpkg.com/optik-sol"></script>
```

```bash
npm i optik-sol
```

```ts
import { mount } from 'optik-sol';

if (import.meta.env.DEV) {
  mount();
}
```

Console, Network, Elements, Storage and Environment panels, in a single file of roughly 46 KB gzipped. Recording starts the moment the script executes, and `destroy()` restores every hook it installed.

> Do not mount unconditionally in production: the panel reads request headers, request bodies and local storage, and is reachable by any script on the page.

Usage, API, development notes and the security policy are in the [GitHub repository](https://github.com/Moresyl/optik-sol#readme).

MIT
