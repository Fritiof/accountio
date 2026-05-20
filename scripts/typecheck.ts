#!/usr/bin/env bun
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { $ } from 'bun';

const APPS = ['backend', 'frontend'] as const;
const root = resolve(import.meta.dir, '..');

let ran = 0;
for (const app of APPS) {
  const tsconfig = resolve(root, app, 'tsconfig.json');
  if (!existsSync(tsconfig)) {
    console.log(`↷ skipping ${app}: ${tsconfig} not found yet`);
    continue;
  }
  console.log(`▶ typecheck ${app}`);
  await $`bun run --cwd ${app} typecheck`;
  ran++;
}

if (ran === 0) {
  console.log('↷ no apps with tsconfig.json yet — nothing to typecheck');
}
