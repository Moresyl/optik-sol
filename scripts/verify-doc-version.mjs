import { readFile } from 'node:fs/promises';

const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(await readFile(new URL('../packages/optik/package.json', import.meta.url), 'utf8'));
if (root.version !== pkg.version) throw new Error('root and optik package versions differ');
const files = ['README.md','README.zh-CN.md','docs/index.md','docs/en/index.md','docs/guide/getting-started.md','docs/en/guide/getting-started.md'];
for (const file of files) {
  const text = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  if (!text.includes(`optik-sol@${pkg.version}`)) throw new Error(`${file} does not reference optik-sol@${pkg.version}`);
}
console.log(`[optik] documentation references ${pkg.version}`);
