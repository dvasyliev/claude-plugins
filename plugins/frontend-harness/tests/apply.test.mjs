// apply.mjs answers: stacks in place of one framework, and the checks on them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REACT_PKG, apply, makeProject } from './helpers.mjs';

const harnessJson = (dir) => JSON.parse(readFileSync(join(dir, '.claude/harness.json'), 'utf8'));

test('an old harness.json with framework becomes stacks', () => {
  const old = { framework: 'react', modules: ['core', 'oxlint'] };
  const dir = makeProject({ 'package.json': REACT_PKG, '.claude/harness.json': JSON.stringify(old) });
  const r = apply(dir, {});
  assert.equal(r.status, 0, r.stderr);
  const json = harnessJson(dir);
  assert.deepEqual(json.stacks, ['react']);
  assert.deepEqual(json.srcDirs, { react: ['src'] });
  assert.equal('framework' in json, false);
});

test('stacks that exclude each other fail', () => {
  const dir = makeProject({ 'package.json': REACT_PKG });
  const r = apply(dir, { stacks: ['react', 'nextjs'], modules: ['core', 'oxlint'] });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /excludes/);
});

test('a stack without a linter fails', () => {
  const dir = makeProject({ 'package.json': REACT_PKG });
  const r = apply(dir, { stacks: ['react'], modules: ['core'] });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /one linter for react/);
});
