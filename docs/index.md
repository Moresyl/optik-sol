---
layout: home

hero:
  name: Optik Sol
  text: 把移动端问题变成可复制的证据
  tagline: 一个脚本、零服务端、零运行时依赖。在手机浏览器和 WebView 内完成日志、网络、DOM、存储与性能诊断。
  image:
    src: /optik-mark.svg
    alt: Optik Sol 几何镜头标志
  actions:
    - theme: brand
      text: 5 分钟接入
      link: /guide/getting-started
    - theme: alt
      text: 查看能力对比
      link: /comparison
    - theme: alt
      text: GitHub
      link: https://github.com/Moresyl/optik-sol

features:
  - icon: ◈
    title: 调试闭环，不只是日志
    details: 同时捕获控制台、异常、XHR、Fetch、Beacon、WebSocket、SSE、资源时序、DOM、存储与主线程长任务。
  - icon: ⌘
    title: 结构化、可搜索、可复制
    details: JSON 树与代码双视图、语法高亮、行号、折叠、批量复制、cURL 与隐私安全的 HAR 1.2 导出。
  - icon: ⛨
    title: 默认保护敏感信息
    details: HAR 默认省略正文并脱敏凭据；所有数据留在当前页面，除非你显式绑定可信传输。
  - icon: ⇄
    title: 为真实 WebView 设计
    details: Shadow DOM 隔离、100dvh、安全区、44px 触控目标、非 HTTPS 复制降级与不完整 API 兼容。
  - icon: ◫
    title: 大数据量仍有边界
    details: 环形缓冲、惰性对象句柄、有上限的树展开与正文捕获，长时间调试不会无限增长。
  - icon: ⟷
    title: 可扩展的协议内核
    details: 内核与 UI 通过 CDP 形状协议解耦，可接 Worker、WebSocket 或自定义插件而无需重写采集层。
---

## 一行开始

```html
<script src="https://unpkg.com/optik-sol@0.4.1"></script>
```

脚本执行后立刻开始采集，点击页面右下角的 **Optik** 即可打开面板。需要打包器、按需挂载或严格的生产环境控制？继续阅读[快速开始](/guide/getting-started)。

::: warning 只在受控环境启用
Optik 能读取请求头、请求正文和页面存储。不要在不可信页面或面向所有用户的生产构建中无条件挂载。
:::
