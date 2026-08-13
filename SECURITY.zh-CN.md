# 安全策略

[English](SECURITY.md) | 简体中文

## 支持的版本

项目仍在 0.x 阶段，只对**最新发布版本**提供安全修复。

## 报告漏洞

**请不要通过公开 Issue 报告安全问题。**

优先使用 GitHub 的[私密漏洞报告](https://github.com/Moresyl/optik-sol/security/advisories/new)，或发送邮件至 **xd@biekanle.com**。请尽量包含受影响的版本与接入方式、复现步骤（最好是一个最小可复现页面）、以及你判断的影响范围。

我们会在 **72 小时内**确认收到，修复发布后于致谢中署名（除非你希望匿名）。

## 威胁模型

以下三条是**设计如此**，不属于漏洞：

- **Optik Sol 会读取页面上的敏感数据。** 它记录请求头（含 `Authorization`、`Cookie`）、请求体、响应体、localStorage 与 Cookie，显示在面板上并允许复制走。这是调试器的本职工作。
- **Optik Sol 会给页面打补丁。** 它替换 `console` 方法、`XMLHttpRequest`、`fetch`、`navigator.sendBeacon`、`WebSocket`、`EventSource`，并监听全局错误。所有替换透传原实现，`destroy()` 按原始属性描述符还原。
- **面板对页面上任何脚本都是可达的**（`window.Optik`）。它没有、也不打算有权限边界。

由此得出唯一一条强制要求：

> **不要在生产环境无条件挂载 Optik Sol。** 用环境变量、构建期常量或某种开关把它挡在生产之外。

真正算漏洞的，是面板**自身**引入了页面原本没有的攻击面：

- 日志或响应体的渲染存在 XSS（面板内所有内容都应作为文本渲染，不解析 HTML）
- 插桩在异常路径上把宿主数据泄漏给第三方
- `destroy()` 之后仍有残留的插桩或引用
- 面板导致宿主页面的 CSP 被削弱

这些请务必报告。
