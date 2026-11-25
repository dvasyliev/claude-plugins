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

test('old module names become their new ones, and the split core modules are added', () => {
  const old = { stacks: ['react'], modules: ['core', 'oxlint', 'knip', 'jscpd'] };
  const dir = makeProject({ 'package.json': REACT_PKG, '.claude/harness.json': JSON.stringify(old) });
  const r = apply(dir, {});
  assert.equal(r.status, 0, r.stderr);
  const json = harnessJson(dir);
  for (const id of ['unused', 'dupes', 'prettier', 'types']) assert.ok(json.modules.includes(id), id);
  for (const id of ['knip', 'jscpd']) assert.ok(!json.modules.includes(id), id);
  const names = json.checks.map((c) => c.name);
  for (const name of ['knip', 'dupes', 'types', 'format']) assert.ok(names.includes(name), name);
});

test('passed answers with old module names are renamed too', () => {
  const dir = makeProject({ 'package.json': REACT_PKG });
  const r = apply(dir, { stacks: ['react'], modules: ['core', 'oxlint', 'knip', 'jscpd'] });
  assert.equal(r.status, 0, r.stderr);
  const json = harnessJson(dir);
  assert.ok(json.modules.includes('unused') && json.modules.includes('dupes'));
  assert.ok(!json.modules.includes('knip') && !json.modules.includes('jscpd'));
});
