// The node stack: package.json is created, and the js modules that need a framework or a tsconfig stay out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { apply, makeProject, snapshot } from './helpers.mjs';

const PYPROJECT = '[project]\nname = "app"\nversion = "0.1.0"\n';
const ANSWERS = { stacks: ['python', 'node'], modules: ['core', 'types', 'ruff', 'oxlint', 'prettier', 'unit'], srcDirs: { python: ['app'], node: ['scripts'] } };
const read = (dir, path) => readFileSync(join(dir, path), 'utf8');
const typeCheck = (dir) => JSON.parse(read(dir, '.claude/harness.json')).checks.some((c) => c.name === 'types');

test('node with Python creates package.json and keeps its stacks', () => {
  const dir = makeProject({ 'pyproject.toml': PYPROJECT, 'scripts/a.mjs': 'export const a = 1;\n' });
  const r = apply(dir, ANSWERS);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /harness: created package.json for the node stack/);
  assert.equal(read(dir, 'package.json').startsWith(`{\n  "name": "${basename(dir)}",\n  "private": true`), true);
  assert.equal(JSON.parse(read(dir, 'package.json')).private, true);
  assert.deepEqual(JSON.parse(read(dir, '.claude/harness.json')).stacks, ['python', 'node']);
  assert.match(read(dir, '.prettierignore'), /\*\.mjs/);
  assert.match(read(dir, '.oxlintrc.json'), /import\/no-cycle/);
});

test('types adds no tsc check without tsconfig.json; with it, it does', () => {
  const without = makeProject({ 'pyproject.toml': PYPROJECT, 'scripts/a.mjs': '' });
  assert.equal(apply(without, ANSWERS).status, 0);
  assert.equal(typeCheck(without), false);
  const withTs = makeProject({ 'pyproject.toml': PYPROJECT, 'tsconfig.json': '{}', 'scripts/a.mjs': '' });
  assert.equal(apply(withTs, ANSWERS).status, 0);
  assert.equal(typeCheck(withTs), true);
});

test('node excludes react', () => {
  const dir = makeProject({ 'package.json': '{}' });
  const r = apply(dir, { stacks: ['node', 'react'], modules: ['core'] });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /excludes/);
});

test('a second run changes nothing', () => {
  const dir = makeProject({ 'pyproject.toml': PYPROJECT, 'scripts/a.mjs': '' });
  assert.equal(apply(dir, ANSWERS).status, 0);
  const before = snapshot(dir);
  assert.equal(apply(dir, {}).status, 0);
  assert.deepEqual(snapshot(dir), before);
  assert.equal(existsSync(join(dir, 'package.json')), true);
});

test('node is detected by its server framework, not by files a React project also has', () => {
  const { detect } = JSON.parse(readFileSync(new URL('../modules.json', import.meta.url), 'utf8')).stacks.node;
  assert.deepEqual(detect, { dependencies: ['express', 'fastify'] });
});
