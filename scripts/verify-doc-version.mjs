import { readFile } from 'node:fs/promises';

const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const packageFiles = ['core', 'ui', 'optik'].map((name) => `../packages/${name}/package.json`);
const packages = await Promise.all(packageFiles.map((file) => readFile(new URL(file, import.meta.url), 'utf8').then(JSON.parse)));
const pkg = packages.find((item) => item.name === 'optik-sol');
if (!pkg || packages.some((item) => item.version !== root.version)) throw new Error('workspace package versions differ');
const files = ['README.md','README.zh-CN.md','docs/index.md','docs/en/index.md','docs/guide/getting-started.md','docs/en/guide/getting-started.md'];
for (const file of files) {
  const text = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  if (!text.includes(`optik-sol@${pkg.version}`)) throw new Error(`${file} does not reference optik-sol@${pkg.version}`);
}
console.log(`[optik] documentation references ${pkg.version}`);
