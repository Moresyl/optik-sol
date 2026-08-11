import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

/**
 * 两套产物必须**分两次构建**，不能靠多入口一把出。
 * 多入口时 rollup 会把共享代码抽成公共 chunk，IIFE 产物就变成了「一个壳 + 一个
 * 外部 chunk」——`<script src>` 使用者只会引到那个几百字节的壳，页面直接报错。
 * 单入口 + `inlineDynamicImports` 才能保证是真正的单文件。
 *
 *  - `optik.js` / `optik.cjs`：给打包器用
 *  - `optik.global.js`：单文件 IIFE，挂 `window.Optik` 并自动挂载
 */
const isGlobal = process.env['OPTIK_TARGET'] === 'global';

export default defineConfig({
  plugins: [solid()],
  build: {
    // global 是第二趟构建，清空产物目录会把上一趟的结果一起删掉。
    emptyOutDir: !isGlobal,
    lib: isGlobal
      ? {
          entry: 'src/global.ts',
          formats: ['iife'],
          // 经典脚本里顶层 `var Optik` 即 `window.Optik`。
          name: 'Optik',
          fileName: () => 'optik.global.js',
        }
      : {
          entry: 'src/index.ts',
          formats: ['es', 'cjs'],
          fileName: (format) => (format === 'es' ? 'optik.js' : 'optik.cjs'),
        },
    // 一切都打进来：接入方只要一个文件，没有 peer 依赖要操心。
    rollupOptions: {
      external: [],
      output: {
        inlineDynamicImports: true,
        ...(isGlobal ? { exports: 'default' as const } : {}),
      },
    },
    target: 'es2019',
    minify: 'esbuild',
    sourcemap: true,
  },
});
