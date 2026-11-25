// The hooks run the commands that .claude/harness.json lists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanEnv, makeProject } from './helpers.mjs';

const hooks = join(dirname(fileURLToPath(import.meta.url)), '..', 'modules/shared/core/all/.claude/hooks');

function project(harness, files = {}) {
  return makeProject({ '.claude/harness.json': JSON.stringify(harness), ...files });
}

function run(dir, hook, args, input = '') {
  const r = spawnSync('bash', [join(hooks, hook), ...args], {
    cwd: dir,
    input,
    encoding: 'utf8',
    env: cleanEnv({ CLAUDE_PROJECT_DIR: dir }),
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test('check-all.sh --force reports a failing command with its output', () => {
  const dir = project({ checks: [{ name: 'ok', command: 'true' }, { name: 'bad', command: 'echo boom; false' }], fileChecks: [] });
  const r = run(dir, 'check-all.sh', ['--force']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /== bad failed ==/);
  assert.match(r.stderr, /boom/);
});

test('check-all.sh --force is green when every command passes', () => {
  const dir = project({ checks: [{ name: 'ok', command: 'true' }], fileChecks: [] });
  const r = run(dir, 'check-all.sh', ['--force']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /All checks green\./);
});

function fileCheck(blocking, content) {
  const dir = project(
    { checks: [], fileChecks: [{ name: 'lint', command: 'grep -q ok', extensions: ['ts'], blocking }] },
    {},
  );
  const path = join(dir, 'a b.ts');
  writeFileSync(path, content);
  return run(dir, 'format-lint-file.sh', [], JSON.stringify({ tool_input: { file_path: path } }));
}

test('format-lint-file.sh passes a file the command accepts, a path with a space included', () => {
  assert.equal(fileCheck(true, 'ok').status, 0);
});

test('format-lint-file.sh blocks on a failing blocking check', () => {
  const r = fileCheck(true, 'bad');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /lint failed on/);
});

test('format-lint-file.sh ignores a failing non-blocking check', () => {
  assert.equal(fileCheck(false, 'bad').status, 0);
});

test('format-lint-file.sh runs a py file check on a .py file and not on a .ts one', () => {
  const dir = project({ checks: [], fileChecks: [{ name: 'ruff', command: 'grep -q ok', extensions: ['py'], blocking: true }] });
  const edit = (name, content) => {
    writeFileSync(join(dir, name), content);
    return run(dir, 'format-lint-file.sh', [], JSON.stringify({ tool_input: { file_path: join(dir, name) } }));
  };
  assert.equal(edit('a.py', 'bad').status, 2);
  assert.equal(edit('a.py', 'ok').status, 0);
  assert.equal(edit('a.ts', 'bad').status, 0);
});

test('check-all.sh runs a command with a backslash and a newline unchanged', () => {
  const dir = project({ checks: [{ name: 'raw', command: "printf '%s\\n' 'a\\d'\necho two; false" }], fileChecks: [] });
  const r = run(dir, 'check-all.sh', ['--force']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^a\\d\ntwo$/m);
});

test('format-lint-file.sh runs a command with a backslash unchanged', () => {
  const dir = project({ checks: [], fileChecks: [{ name: 'lint', command: "grep -qF 'a\\d'", extensions: ['ts'], blocking: true }] });
  const path = join(dir, 'a.ts');
  writeFileSync(path, 'a\\d\n');
  const r = run(dir, 'format-lint-file.sh', [], JSON.stringify({ tool_input: { file_path: path } }));
  assert.equal(r.status, 0, r.stderr);
});

test('session-start.sh asks for uv sync in a Python project without .venv, and names no port without one', () => {
  const dir = project({ checks: [], fileChecks: [] }, { 'pyproject.toml': '[project]\nname = "app"\n' });
  const r = run(dir, 'session-start.sh', []);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Python dependencies are not installed \(uv sync\)/);
  assert.doesNotMatch(r.stdout, /port/);
});

test('guard.sh blocks force push, skipped git hooks and secret env files, and lets the rest through', () => {
  const dir = project({ checks: [], fileChecks: [] });
  const guard = (tool_input) => run(dir, 'guard.sh', [], JSON.stringify({ tool_input })).status;
  const E = '.' + 'env';
  for (const blocked of [
    { command: 'git push --force origin main' },
    { command: 'git commit -m x --no-verify' },
    { command: `cat ${E}.local` },
    { file_path: join(dir, E) },
    { file_path: join(dir, `${E}.production`) },
    { path: dir, glob: `${E}*` },
  ]) assert.equal(guard(blocked), 2, JSON.stringify(blocked));
  for (const allowed of [
    { command: 'git push origin main' },
    { command: 'git commit -F .githooks/pre-push' },
    { command: `cp ${E}.example /tmp/x` },
    { file_path: join(dir, `${E}.example`) },
    { file_path: join(dir, 'src/app.ts') },
  ]) assert.equal(guard(allowed), 0, JSON.stringify(allowed));
});
