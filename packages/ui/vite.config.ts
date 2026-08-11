import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs'),
    },
    // solid-js 是 peer 依赖，不打进来，避免宿主应用出现两份运行时。
    rollupOptions: { external: ['solid-js', 'solid-js/web', 'solid-js/store'] },
    target: 'es2019',
    minify: false,
    sourcemap: true,
  },
});
