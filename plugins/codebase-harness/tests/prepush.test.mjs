// The pre-push dispatcher: runs .githooks/pre-push.d/* in name order, then pre-push.local.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply, cleanEnv, makeProject } from './helpers.mjs';

const OLD_HOOK = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'old-pre-push'), 'utf8');
const REFS = 'refs/heads/main aaaa refs/heads/main bbbb';

// A react project with playwright applied; `verify` appends to verify.log.
function setup() {
  const dir = makeProject({
    'package.json': '{"name":"smoke","private":true,"scripts":{"dev":"vite","verify":"echo verify >> verify.log"},"dependencies":{"react":"19.2.0","react-dom":"19.2.0"},"devDependencies":{"vite":"7.0.0"}}',
  });
  const r = apply(dir, { stacks: ['react'], modules: ['core', 'oxlint', 'playwright'] });
  assert.equal(r.status, 0, r.stderr);
  // apply.mjs may overwrite the verify script with its own; set it back to the fake.
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  pkg.scripts.verify = 'echo verify >> verify.log';
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
  return dir;
}

// A step that logs its name and the stdin it got.
function addStep(dir, path, { exec = true, exit = 0 } = {}) {
  const file = join(dir, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `#!/bin/sh\necho "${path} $(cat)" >> "${dir}/steps.log"\nexit ${exit}\n`);
  if (exec) chmodSync(file, 0o755);
}

function push(dir, env = {}) {
  const r = spawnSync('sh', ['.githooks/pre-push', 'origin', 'url'], { cwd: dir, input: REFS + '\n', encoding: 'utf8', env: cleanEnv(env) });
  let log = '';
  try { log = readFileSync(join(dir, 'steps.log'), 'utf8'); } catch {}
  let verify = '';
  try { verify = readFileSync(join(dir, 'verify.log'), 'utf8'); } catch {}
  return { ...r, log: log.trim().split('\n').filter(Boolean), verify };
}

test('dispatcher runs pre-push.d steps in name order with the refs, then pre-push.local', () => {
  const dir = setup();
  addStep(dir, '.githooks/pre-push.d/b');
  addStep(dir, '.githooks/pre-push.d/a');
  addStep(dir, '.githooks/pre-push.local');
  const r = push(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.log, [`.githooks/pre-push.d/a ${REFS}`, `.githooks/pre-push.d/b ${REFS}`, `.githooks/pre-push.local ${REFS}`]);
  assert.equal(r.verify, 'verify\n');
});

test('playwright sorts after a and b and before pre-push.local', () => {
  const dir = setup();
  // Make the order visible: a step after "playwright" in name order, and verify logs into the same file.
  addStep(dir, '.githooks/pre-push.d/a');
  addStep(dir, '.githooks/pre-push.d/z');
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  pkg.scripts.verify = `echo playwright >> ${dir}/steps.log`;
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
  addStep(dir, '.githooks/pre-push.local');
  const r = push(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.log.map((l) => l.split(' ')[0]), ['.githooks/pre-push.d/a', 'playwright', '.githooks/pre-push.d/z', '.githooks/pre-push.local']);
});

test('a failing step stops the push and later steps do not run', () => {
  const dir = setup();
  addStep(dir, '.githooks/pre-push.d/a', { exit: 1 });
  addStep(dir, '.githooks/pre-push.local');
  const r = push(dir);
  assert.notEqual(r.status, 0);
  assert.deepEqual(r.log, [`.githooks/pre-push.d/a ${REFS}`]);
  assert.equal(r.verify, '');
});

test('a non-executable file in pre-push.d is skipped', () => {
  const dir = setup();
  addStep(dir, '.githooks/pre-push.d/a', { exec: false });
  const r = push(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.log, []);
  assert.equal(r.verify, 'verify\n');
});

test('SKIP_VERIFY=1 skips the tests but not the other steps', () => {
  const dir = setup();
  addStep(dir, '.githooks/pre-push.d/a');
  addStep(dir, '.githooks/pre-push.local');
  const r = push(dir, { SKIP_VERIFY: '1' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.log, [`.githooks/pre-push.d/a ${REFS}`, `.githooks/pre-push.local ${REFS}`]);
  assert.equal(r.verify, '');
});

test('an edited old pre-push conflicts instead of being overwritten', () => {
  const dir = setup();
  // Simulate a project installed with the old hook: its text is the file and the base, plus a user edit.
  const hook = join(dir, '.githooks', 'pre-push');
  const harness = join(dir, '.claude', 'harness.json');
  const json = JSON.parse(readFileSync(harness, 'utf8'));
  json.base['.githooks/pre-push'] = OLD_HOOK;
  writeFileSync(harness, JSON.stringify(json, null, 2) + '\n');
  // The edit is inside the logic that moved, so the harness version cannot be merged in cleanly.
  writeFileSync(hook, OLD_HOOK.replace('running npm run verify', 'running my own verify'));
  const r = apply(dir, { stacks: ['react'], modules: ['core', 'oxlint', 'playwright'] });
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(hook, 'utf8'), /<<<<<<< project/);
});

test('an unedited old pre-push is replaced by the dispatcher', () => {
  const dir = setup();
  const hook = join(dir, '.githooks', 'pre-push');
  const harness = join(dir, '.claude', 'harness.json');
  const json = JSON.parse(readFileSync(harness, 'utf8'));
  json.base['.githooks/pre-push'] = OLD_HOOK;
  writeFileSync(harness, JSON.stringify(json, null, 2) + '\n');
  writeFileSync(hook, OLD_HOOK);
  const r = apply(dir, { stacks: ['react'], modules: ['core', 'oxlint', 'playwright'] });
  assert.equal(r.status, 0, r.stderr);
  const dispatcher = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'modules', 'web', 'playwright', 'all', '.githooks', 'pre-push'), 'utf8');
  assert.equal(readFileSync(hook, 'utf8'), dispatcher);
});
