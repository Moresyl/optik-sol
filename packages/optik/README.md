# optik-sol

移动端网页调试面板。一个 `<script>` 标签，零服务端，零运行时依赖。

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

用法、API、开发说明与安全策略见 [GitHub 仓库](https://github.com/Moresyl/optik-sol#readme)。

MIT
