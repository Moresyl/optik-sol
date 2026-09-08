# 协议与传输

## 消息模型

```ts
type Request = { id: number; method: string; params?: unknown };
type SuccessResponse = { id: number; result: unknown };
type ErrorResponse = { id: number; error: ProtocolError };
type Event = { method: string; params?: unknown };
```

`ProtocolClient` 负责请求 ID、超时、取消和响应匹配；`ProtocolRouter` 负责方法注册、参数校验、异常归一化与事件发送。

## 内核方法

`KernelProtocolMethods` 包含日志、网络、性能与系统域的查询、清理和对象释放方法。列表查询都支持 `offset` / `limit`，单页最多 1000 条。

```ts
const result = await client.request(KernelProtocolMethods.LogEntries, {
  offset: 0,
  limit: 100,
});

console.log(result.entries, result.total);
```

## 对象句柄

日志和网络正文中的对象属性按需展开。客户端借用子句柄后必须调用对应的 `Log.releaseObject` 或 `Network.releaseObject`；协议会话销毁时，服务端释放仍未归还的借用。

## 传输契约

一个 `Transport` 必须：

- 按原顺序传递完整消息
- 返回可注销的消息监听器
- 关闭后拒绝新消息
- 允许双方独立关闭而不泄漏监听器

进程内实现用于测试、同页客户端和自定义桥接的起点。远程实现还必须处理认证、加密、消息大小、心跳、断线重连和重放攻击。

## 错误模型

协议错误使用稳定的 `ErrorCode` 与安全消息，不把内部堆栈、原始异常对象或敏感数据暴露给不可信客户端。调用方应按错误码处理，不要依赖本地化消息文本。
