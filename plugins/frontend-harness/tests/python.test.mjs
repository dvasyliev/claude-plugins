// The python stack: dev dependencies read from pyproject.toml, and apply.mjs without package.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { missingDevDeps } from '../tasks/lib/python.mjs';
import { REACT_PKG, apply, makeProject } from './helpers.mjs';

const harnessJson = (dir) => JSON.parse(readFileSync(join(dir, '.claude/harness.json'), 'utf8'));
const PYPROJECT = '[project]\nname = "app"\nversion = "0.1.0"\n';

test('missingDevDeps finds the names the dev group lacks', () => {
  const text = '[dependency-groups]\ndev = ["ruff>=0.17", "Basedpyright"]';
  assert.deepEqual(missingDevDeps(text, ['ruff', 'basedpyright', 'pytest']), ['pytest']);
});

test('missingDevDeps reads a multi-line group and [tool.uv] dev-dependencies', () => {
  const text = [
    '[project]',
    'dependencies = ["requests"]',
    '',
    '[dependency-groups]',
    'dev = [',
    '    "pytest-cov[toml]>=5", # coverage',
    "    'import_linter ; python_version >= \"3.10\"',",
    ']',
    '',
    '[tool.uv]',
    'dev-dependencies = ["Vulture~=2.0", "deptry @ git+https://example.com/deptry"]',
  ].join('\n');
  const wanted = ['pytest-cov', 'import-linter', 'vulture', 'deptry', 'requests'];
  assert.deepEqual(missingDevDeps(text, wanted), ['requests']);
});

// The catalog has no python linter yet, so the stack needs none (react without one still fails: apply.test.mjs).
test('a python-only project needs no package.json, no port and no linter', () => {
  const dir = makeProject({ 'pyproject.toml': PYPROJECT });
  const r = apply(dir, { stacks: ['python'], modules: ['core'] });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(join(dir, 'package.json')), false);
  const json = harnessJson(dir);
  assert.deepEqual(json.stacks, ['python']);
  assert.equal('port' in json, false);
  assert.doesNotMatch(readFileSync(join(dir, '.claude/rules/harness.md'), 'utf8'), /run dev/);
});

test('a pnpm React and Python project runs the js checks through pnpm', () => {
  const dir = makeProject({ 'package.json': REACT_PKG, 'pnpm-lock.yaml': '', 'pyproject.toml': PYPROJECT });
  const r = apply(dir, { stacks: ['react', 'python'], modules: ['core', 'oxlint'] });
  assert.equal(r.status, 0, r.stderr);
  const { checks, fileChecks } = harnessJson(dir);
  assert.ok(checks.length);
  for (const c of [...checks, ...fileChecks]) assert.ok(c.command.startsWith('pnpm run -s '), c.command);
  // No module brings a Python check yet; Task 8 (ruff, basedpyright) adds them, and this test then
  // asserts that each Python check command starts with `uv run `.
  assert.equal(checks.some((c) => c.command.startsWith('uv run ')), false);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.check, '.claude/hooks/check-all.sh --force');
});
