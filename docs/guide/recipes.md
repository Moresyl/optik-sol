# 实战配方

## 导出隐私安全的 HAR

网络面板的 HAR 复制默认：

- 脱敏认证头、Cookie、令牌、密码、签名与常见凭据字段
- 从 URL、跳转地址和查询参数中移除敏感值
- 不包含请求/响应正文和 WebSocket 帧正文

代码中可以使用同一套导出器：

```ts
import { serializeHar } from 'optik-sol';

const har = serializeHar(optik.kernel.network.records());
```

只有在确认接收方和传输路径可信后，才显式加入正文：

```ts
const har = serializeHar(optik.kernel.network.records(), {
  includeBodies: true,
  includeWebSocketFrames: true,
});
```

`redactSensitive: false` 会保留原始凭据，不应出现在工单、群聊或公共 Issue 中。

## 只对授权用户启用

```ts
async function enableSupportConsole() {
  const response = await fetch('/internal/debug-session', { credentials: 'include' });
  if (!response.ok) return;

  const { mount } = await import('optik-sol');
  return mount({ defaultOpen: true, maxBodyBytes: 128 * 1024 });
}
```

动态导入可让普通用户的生产包不加载 Optik；服务端接口仍需执行真正的权限和有效期校验。

## 添加业务诊断插件

```ts
optik.use({
  id: 'account',
  label: '账号',
  render(context) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '复制账号上下文';
    button.addEventListener('click', () => {
      context.copy(JSON.stringify({ tenant: 'demo', role: 'tester' }, null, 2), '账号上下文');
    });
    return button;
  },
});
```

插件节点会缓存，切换标签不会丢失内部状态；插件异常会被隔离并记录，不会让宿主页面崩溃。

## 连接 Worker 或自定义 transport

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

自定义远程 transport 必须负责认证、加密、会话隔离、限流与重放保护。Optik 不会自动把采集数据上传到任何服务。
