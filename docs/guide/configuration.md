# 配置参考

## `mount(options)`

```ts
const optik = mount({
  theme: 'light',
  defaultOpen: false,
  defaultTab: 'console',
  log: { maxEntries: 1000 },
  network: { maxRecords: 300 },
  performance: { maxLongTasks: 200 },
  maxBodyBytes: 512 * 1024,
  passthrough: true,
  capture: {
    console: true,
    exceptions: true,
    rejections: true,
    resourceErrors: true,
    cspViolations: true,
    xhr: true,
    fetch: true,
    beacon: true,
    websocket: true,
    eventSource: true,
    resourceTiming: true,
    longTasks: true,
  },
});
```

| 选项 | 类型 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `container` | `HTMLElement` | `document.body` | Shadow DOM 宿主插入位置 |
| `theme` | `'light' \| 'dark'` | `'light'` | 初始主题；面板内可切换 |
| `defaultOpen` | `boolean` | `false` | 挂载后立即展开 |
| `defaultTab` | `TabId` | `'console'` | 首次展示的内置或插件标签 |
| `plugins` | `OptikPlugin[]` | `[]` | 启动时注册的插件 |
| `log.maxEntries` | `number` | `5000` | 日志环形缓冲上限 |
| `network.maxRecords` | `number` | `1000` | 网络记录环形缓冲上限 |
| `performance.maxLongTasks` | `number` | `200` | 长任务记录上限 |
| `maxBodyBytes` | `number` | `524288` | 单个请求或响应正文保留上限 |
| `passthrough` | `boolean` | `true` | 是否继续调用原生 `console` |

所有容量必须是 `1` 到 `1,000,000` 之间的有限数值；运行时调整会按新的上限截断已有数据。

## 采集开关

`capture` 里的每一项默认启用。只需要日志时，可以关闭网络与性能采集：

```ts
mount({
  capture: {
    xhr: false,
    fetch: false,
    beacon: false,
    websocket: false,
    eventSource: false,
    resourceTiming: false,
    longTasks: false,
  },
});
```

::: tip Resource Timing 会补充非 JavaScript 请求
图片、样式、字体等没有 XHR/Fetch 调用点的资源通过 Resource Timing 进入网络面板。关闭它们可以减少记录，但也会失去这类请求与缓存命中信息。
:::

## script 属性

| 属性 | 示例 | 说明 |
| --- | --- | --- |
| `data-theme` | `data-theme="dark"` | 初始主题 |
| `data-open` | `data-open` | 默认展开 |
| `data-max-logs` | `data-max-logs="2000"` | 日志上限 |
| `data-max-requests` | `data-max-requests="500"` | 网络记录上限 |
| `data-max-long-tasks` | `data-max-long-tasks="100"` | 长任务上限 |
| `data-optik-manual` | `data-optik-manual` | 禁止 IIFE 自动挂载 |

非法数字或超出容量范围的值会被忽略并使用默认值。

## 生命周期

```ts
const optik = mount();

optik.show();             // 打开当前标签
optik.show('storage');    // 打开并切换标签
optik.hide();             // 保留采集，仅隐藏 UI
optik.destroy();          // 停止采集、释放句柄、还原原生方法并移除 UI
```

如果插件或渲染在挂载期间失败，`mount()` 会事务式回滚已安装的采集器和 DOM。
