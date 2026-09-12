import { createRequire } from 'node:module';
import { access, readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const corePackage = JSON.parse(await readFile(new URL('../packages/core/package.json', import.meta.url), 'utf8'));
const coreExports = corePackage.exports?.['.'];
for (const [condition, field] of [['types', 'types'], ['browser', 'browser'], ['import', 'module'], ['require', 'main']]) {
  if (coreExports?.[condition] !== corePackage[field]) {
    throw new Error(`optik-core exports.${condition} must match package ${field} entry`);
  }
  await access(new URL(`../packages/core/${corePackage[field]}`, import.meta.url));
}
if (coreExports?.default !== corePackage.module) {
  throw new Error('optik-core default export must match the ESM module entry');
}
const packageJson = JSON.parse(await readFile(new URL('../packages/optik/package.json', import.meta.url), 'utf8'));
const uiPackage = JSON.parse(await readFile(new URL('../packages/ui/package.json', import.meta.url), 'utf8'));
for (const field of ['main', 'module', 'types']) {
  if (uiPackage.exports?.['.']?.[field === 'module' ? 'import' : field] !== uiPackage[field]) {
    throw new Error(`optik-ui exports metadata must match package ${field} entry`);
  }
  await access(new URL(`../packages/ui/${uiPackage[field]}`, import.meta.url));
}
if (!Array.isArray(packageJson.sideEffects) || !packageJson.sideEffects.includes('./dist/optik.global.js')) {
  throw new Error('package metadata must preserve the global entry side effect');
}
for (const field of ['main', 'module', 'browser', 'unpkg', 'jsdelivr', 'types']) {
  if (typeof packageJson[field] !== 'string' || !packageJson[field].startsWith('./dist/')) {
    throw new Error(`package metadata has an invalid ${field} entry`);
  }
  try {
    await access(new URL(`../packages/optik/${packageJson[field]}`, import.meta.url));
  } catch {
    throw new Error(`package metadata points to a missing ${field} file: ${packageJson[field]}`);
  }
}
const defaultExport = packageJson.exports?.['.']?.default;
if (defaultExport !== packageJson.module) {
  throw new Error(`default export must match the ESM module entry: ${defaultExport}`);
}
const rootExports = packageJson.exports?.['.'];
for (const [condition, field] of [['types', 'types'], ['browser', 'browser'], ['import', 'module'], ['require', 'main']]) {
  if (rootExports?.[condition] !== packageJson[field]) {
    throw new Error(`exports.${condition} must match package ${field} entry`);
  }
}
const esm = await import('../packages/optik/dist/optik.js');
const cjs = require('../packages/optik/dist/optik.cjs');
const coreEsm = await import('../packages/core/dist/index.js');
const coreCjs = require('../packages/core/dist/index.cjs');
for (const [format, api] of [['core ESM', coreEsm], ['core CJS', coreCjs]]) {
  for (const name of ['OptikKernel', 'ProtocolClient']) {
    if (typeof api[name] !== 'function') throw new Error(`${format} build is missing the ${name} export`);
  }
}

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
