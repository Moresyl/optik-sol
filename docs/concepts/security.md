# 隐私与安全

## 默认边界

- 不连接远程服务，不发送遥测
- HAR 默认脱敏凭据并省略正文
- 结构化 JSON 只在当前页面解析和展示
- 请求/响应正文受 `maxBodyBytes` 限制
- 环境面板中的页面地址默认移除凭据、查询参数和片段；只有显式点击才显示原始地址
- 网络记录会移除 URL 的用户名和密码部分；查询参数仍按 HAR 的脱敏规则处理
- 复制 cURL 命令默认脱敏 URL 凭据、敏感查询参数、敏感请求头和结构化请求体字段
- 网络详情复制对查询参数及请求/响应头统一采用相同的脱敏边界
- 大对象、树展开、日志、网络与长任务均使用上限

## 仍然需要你的判断

Optik 与页面运行在同一 JavaScript 上下文。任何能执行页面脚本的代码都可能读取同样的数据，因此它不是安全隔离沙箱，也不应替代访问控制、服务端审计或生产脱敏。

## 安全导出清单

导出前确认：

1. 接收方是否有权限看到 URL、头和正文
2. 是否需要开启 `includeBodies`
3. 是否需要开启 `includeWebSocketFrames`
4. 是否应保留默认 `redactSensitive: true`
5. 工单或 Issue 中是否还包含截图、控制台复制文本和设备信息

```ts
const safe = serializeHar(records, {
  redactSensitive: true,
  includeBodies: false,
  includeWebSocketFrames: false,
});
```

## 远程 transport

自定义 transport 必须提供 TLS、身份验证、会话隔离、消息大小限制、速率限制和重放保护。不要把 `createInProcessTransportPair()` 当作网络安全方案；它只负责进程内消息边界。
