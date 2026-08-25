import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
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
