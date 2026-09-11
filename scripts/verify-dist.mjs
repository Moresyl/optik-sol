import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const packageJson = JSON.parse(await readFile(new URL('../packages/optik/package.json', import.meta.url), 'utf8'));
for (const field of ['main', 'module', 'browser', 'unpkg', 'jsdelivr', 'types']) {
  if (typeof packageJson[field] !== 'string' || !packageJson[field].startsWith('./dist/')) {
    throw new Error(`package metadata has an invalid ${field} entry`);
  }
}
const esm = await import('../packages/optik/dist/optik.js');
const cjs = require('../packages/optik/dist/optik.cjs');

for (const [format, api] of [
  ['ESM', esm],
  ['CJS', cjs],
]) {
  for (const name of ['mount', 'createHar', 'ProtocolClient']) {
    if (typeof api[name] !== 'function') {
      throw new Error(`${format} build is missing the ${name} export`);
    }
  }
}

// The classic-script build auto-mounts only when a document exists. Importing it in
// Node proves that its feature guard runs before any DOM-dependent runtime code.
await import('../packages/optik/dist/optik.global.js');

console.log('[optik] ESM, CJS, and IIFE builds load without a DOM');
