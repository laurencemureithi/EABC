'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const excluded = new Set(['node_modules', '.git', '.vercel', 'dist', 'build']);
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!excluded.has(entry.name)) walk(path.join(dir, entry.name));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(path.join(dir, entry.name));
    }
  }
}
walk(root);
let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    failed += 1;
    process.stderr.write(`FAIL ${path.relative(root, file)}\n${err.stderr ? err.stderr.toString() : err.message}\n`);
  }
}
if (failed) {
  console.error(`Syntax check failed: ${failed}/${files.length} JavaScript files.`);
  process.exit(1);
}
console.log(`PASS: syntax check completed for ${files.length} JavaScript files.`);
