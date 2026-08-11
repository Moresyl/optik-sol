import dts from 'rollup-plugin-dts';
import { fileURLToPath } from 'node:url';

const workspaceTypes = new Map([
  ['optik-core', fileURLToPath(new URL('../core/dist/index.d.ts', import.meta.url))],
  ['optik-ui', fileURLToPath(new URL('../ui/dist/index.d.ts', import.meta.url))],
]);

export default {
  input: 'dist/types/index.d.ts',
  output: {
    file: 'dist/index.d.ts',
    format: 'es',
  },
  plugins: [
    {
      name: 'workspace-types',
      resolveId(source) {
        return workspaceTypes.get(source) ?? null;
      },
    },
    dts(),
  ],
};
