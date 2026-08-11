import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import QRCode from 'qrcode';

/** Windows 上 `new URL(...).pathname` 会得到 `/D:/...` 这种带前导斜杠的路径，必须转换。 */
const resolve = (path) => fileURLToPath(new URL(path, import.meta.url));

/**
 * 把局域网地址注入页面。
 *
 * 浏览器自己是查不到这个地址的：从 localhost 打开时 `location.host` 就是 localhost，
 * 而真机要访问的是 192.168.x.x。只有服务端知道自己绑在哪些网卡上，
 * 所以必须由 Vite 侧把 `server.resolvedUrls.network` 传给页面。
 */
function lanAddress() {
  return {
    name: 'optik-lan-address',
    apply: 'serve',
    /**
     * transformIndexHtml 在每次请求时执行，此时 listen 早已完成，
     * resolvedUrls 一定已经填好。
     */
    async transformIndexHtml() {
      const urls = rank(globalThis.__optikServer?.resolvedUrls?.network ?? []);
      const entries = await Promise.all(
        urls.map(async (url) => ({
          url,
          // 二维码在 Node 侧生成，客户端不需要引入任何编码库。
          svg: await QRCode.toString(url, {
            type: 'svg',
            margin: 1,
            width: 148,
            errorCorrectionLevel: 'M',
          }),
        })),
      );
      return [
        {
          tag: 'script',
          injectTo: 'head',
          children: `window.__OPTIK_LAN__ = ${JSON.stringify(entries)};`,
        },
      ];
    },
    configureServer(server) {
      // transformIndexHtml 的签名里拿不到 server，挂到全局中转一下。
      globalThis.__optikServer = server;
    },
  };
}

/**
 * Windows 上 `--host` 会把 WSL、Hyper-V、VMware 的虚拟网卡一起列出来
 * （172.16–172.31 段居多），手机连不上这些。把真正的家用/办公网段排前面。
 */
function rank(urls) {
  const score = (url) => {
    const host = new URL(url).hostname;
    if (host.startsWith('192.168.')) return 0;
    if (/^10\./.test(host)) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return 3; // 多半是虚拟网卡
    return 2;
  };
  return [...urls].sort((a, b) => score(a) - score(b));
}

export default defineConfig({
  // 面板源码是 .tsx，别名直指源码就得让 solid 插件参与编译。
  plugins: [solid(), lanAddress()],
  server: {
    // 真机调试要从局域网访问，必须监听 0.0.0.0。
    host: true,
    port: 5173,
  },
  resolve: {
    // 直接指向源码：改完面板代码保存即热更新，不用先构建。
    alias: {
      '@optik/debug': resolve('../packages/optik/src/index.ts'),
      '@optik/ui': resolve('../packages/ui/src/index.ts'),
      '@optik/core': resolve('../packages/core/src/index.ts'),
    },
  },
});
