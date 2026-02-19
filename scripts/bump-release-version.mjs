#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INPUT = process.argv[2];

if (!INPUT) {
  console.error('Usage: pnpm release:bump <version>');
  console.error('Example: pnpm release:bump 0.1.1');
  console.error('Example: pnpm release:bump v0.1.1-rc.1');
  process.exit(1);
}

const version = INPUT.startsWith('v') ? INPUT.slice(1) : INPUT;
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

if (!semverPattern.test(version)) {
  console.error(`Invalid version: ${INPUT}`);
  console.error('Expected: X.Y.Z or X.Y.Z-prerelease');
  process.exit(1);
}

const packageFiles = [
  'packages/sdk/package.json',
  'packages/node/package.json',
  'packages/runtime/package.json',
  'packages/agent/package.json',
  'packages/cli/package.json',
];

for (const relativePath of packageFiles) {
  const filePath = resolve(process.cwd(), relativePath);
  const raw = readFileSync(filePath, 'utf8');
  const pkg = JSON.parse(raw);
  const next = { ...pkg, version };
  writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  console.log(`Updated ${pkg.name} -> ${version}`);
}

console.log('Done. Commit changes, then push a matching git tag.');
