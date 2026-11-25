// The git hooks in a python-only project: no node_modules, so they go through npx and uv (fakes on PATH).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, cleanEnv, makeProject } from './helpers.mjs';

const ANSWERS = { stacks: ['python'], modules: ['core', 'ruff', 'commitlint', 'pre-commit', 'sync-deps'], srcDirs: { python: ['app'] } };

// A project with the hooks applied and a bin dir whose npx, uv and npm only log their arguments.
function setup(uvExit = 0) {
  const dir = makeProject({ 'pyproject.toml': '[project]\nname = "app"\nversion = "0.1.0"\n', 'uv.lock': 'a\n' });
  const r = apply(dir, ANSWERS);
  assert.equal(r.status, 0, r.stderr);
  const bin = mkdtempSync(join(tmpdir(), 'harness-bin-'));
  for (const name of ['npx', 'uv', 'npm']) {
    const file = join(bin, name);
    writeFileSync(file, `#!/bin/sh\necho "${name} $*" >> "${bin}/${name}.log"\n${name === 'uv' ? `exit ${uvExit}` : 'exit 0'}\n`);
    chmodSync(file, 0o755);
  }
  const env = cleanEnv({ PATH: `${bin}:${process.env.PATH}` });
  const run = (cmd, args) => spawnSync(cmd, args, { cwd: dir, env, encoding: 'utf8' });
  const log = (name) => (existsSync(join(bin, `${name}.log`)) ? readFileSync(join(bin, `${name}.log`), 'utf8') : '');
  // Commit without running the hooks under test.
  const commit = () => run('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'x']);
  return { dir, run, log, commit };
}

test('apply turns on .githooks in a project without package.json', () => {
  const { dir, run } = setup();
  assert.equal(existsSync(join(dir, 'package.json')), false);
  assert.equal(run('git', ['config', 'core.hooksPath']).stdout.trim(), '.githooks');
});

test('post-merge runs uv sync when uv.lock changed, and nothing otherwise', () => {
  const { dir, run, log, commit } = setup();
  run('git', ['add', '-A']);
  commit();
  writeFileSync(join(dir, 'uv.lock'), 'b\n');
  run('git', ['add', '-A']);
  commit();
  run('git', ['update-ref', 'ORIG_HEAD', 'HEAD~1']);
  assert.equal(run('sh', ['.githooks/post-merge']).status, 0);
  assert.equal(log('uv').trim(), 'uv sync');
  assert.equal(log('npm'), '');
  run('git', ['update-ref', 'ORIG_HEAD', 'HEAD']);
  run('sh', ['.githooks/post-merge']);
  assert.equal(log('uv').trim(), 'uv sync');
});

test('post-checkout runs uv sync on a branch switch that changed uv.lock', () => {
  const { dir, run, log, commit } = setup();
  run('git', ['add', '-A']);
  commit();
  const before = run('git', ['rev-parse', 'HEAD']).stdout.trim();
  writeFileSync(join(dir, 'uv.lock'), 'b\n');
  run('git', ['add', '-A']);
  commit();
  const after = run('git', ['rev-parse', 'HEAD']).stdout.trim();
  run('sh', ['.githooks/post-checkout', before, after, '0']);
  assert.equal(log('uv'), '');
  run('sh', ['.githooks/post-checkout', before, after, '1']);
  assert.equal(log('uv').trim(), 'uv sync');
});

test('pre-commit checks a staged .py file with secretlint and ruff', () => {
  const { dir, run, log } = setup();
  writeFileSync(join(dir, 'a.py'), 'x = 1\n');
  run('git', ['add', 'a.py']);
  const r = run('sh', ['.githooks/pre-commit']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(log('npx'), /^npx -y -p secretlint@\S+ -p @secretlint\/secretlint-rule-preset-recommend@\S+ secretlint a\.py$/m);
  const uv = log('uv');
  assert.match(uv, /^uv run ruff format --check a\.py$/m);
  assert.match(uv, /^uv run ruff check a\.py$/m);
});

test('pre-commit leaves ruff alone when no .py file is staged', () => {
  const { dir, run, log } = setup();
  writeFileSync(join(dir, 'a.txt'), 'x\n');
  run('git', ['add', 'a.txt']);
  assert.equal(run('sh', ['.githooks/pre-commit']).status, 0);
  assert.match(log('npx'), /secretlint a\.txt/);
  assert.equal(log('uv'), '');
});

test('pre-commit fails when ruff fails', () => {
  const { dir, run } = setup(1);
  writeFileSync(join(dir, 'a.py'), 'x = 1\n');
  run('git', ['add', 'a.py']);
  assert.notEqual(run('sh', ['.githooks/pre-commit']).status, 0);
});

test('commit-msg without node_modules runs a pinned commitlint through npx', () => {
  const { dir, run, log } = setup();
  writeFileSync(join(dir, 'msg'), 'feat: x\n');
  assert.equal(run('sh', ['.githooks/commit-msg', 'msg']).status, 0);
  assert.match(log('npx'), /^npx -y -p @commitlint\/cli@\S+ -p @commitlint\/config-conventional@\S+ commitlint --edit msg$/m);
});
