// Fails if the old name is still used anywhere, or the new one is missing from the definition.
import fs from 'node:fs';
import path from 'node:path';

const skip = new Set(['.git', 'node_modules', '.agent', 'check_rename.mjs']);
const hits = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (fs.readFileSync(p, 'utf8').includes('getUserName')) hits.push(p);
  }
};
walk('.');
if (hits.length) {
  console.error('Old name still present in:\n' + hits.join('\n'));
  process.exit(1);
}
if (!/export function getDisplayName\b/.test(fs.readFileSync('src/users.js', 'utf8'))) {
  console.error('src/users.js does not export function getDisplayName');
  process.exit(1);
}
if (!fs.readFileSync('README.md', 'utf8').includes('getDisplayName')) {
  console.error('README.md does not mention getDisplayName');
  process.exit(1);
}
console.log('rename OK');
