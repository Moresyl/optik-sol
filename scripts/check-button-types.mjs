import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : path.endsWith('.tsx') ? [path] : [];
  });
}

const files = filesUnder('packages/ui/src');
const buttonStart = /<button\b[^>]*>/g;
const missing = [];

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(buttonStart)) {
    if (!/\btype\s*=/.test(match[0])) {
      const line = source.slice(0, match.index).split('\n').length;
      missing.push(`${file}:${line}`);
    }
  }
}

if (missing.length) {
  console.error(`Buttons without an explicit type:\n${missing.join('\n')}`);
  process.exit(1);
}

console.log(`Checked ${files.length} TSX files: all buttons declare type.`);
