// Shared helpers for the plugin tests: build a throwaway project, run apply.mjs in it, and
// compare what it wrote with a golden file.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const APPLY = join(here, '..', 'tasks', 'apply.mjs');

// The two package.json texts and the module lists of the smoke job in .github/workflows/ci.yml.
export const NEXT_PKG = '{"name":"smoke","private":true,"scripts":{"dev":"next dev"},"dependencies":{"next":"16.0.0","react":"19.2.0","react-dom":"19.2.0"}}';
export const REACT_PKG = '{"name":"smoke","private":true,"scripts":{"dev":"vite"},"dependencies":{"react":"19.2.0","react-dom":"19.2.0"},"devDependencies":{"vite":"7.0.0"}}';
const COMMON = ['core', 'tsc', 'prettier', 'feature-workflow', 'LINTER', 'knip', 'dupes', 'tailwind', 'vitest', 'playwright', 'commitlint', 'pre-commit', 'sync-deps', 'react-practices', 'context7', 'libraries', 'next-docs', 'page-speed'];
export const ALL_REACT = COMMON.map((m) => (m === 'LINTER' ? 'oxlint' : m));
export const ALL_NEXT = COMMON.map((m) => (m === 'LINTER' ? 'eslint' : m));

// The environment for child processes: without GIT_* variables (GIT_INDEX_FILE, GIT_DIR ...) that a
// running git hook sets, so the commands here never touch the repository that runs the tests.
export function cleanEnv(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  return { ...env, ...extra };
}

function git(dir, ...args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: cleanEnv() });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
}

export function makeProject(files) {
  // apply.mjs derives the dev server port from the folder name, so the folder name is fixed.
  const dir = join(mkdtempSync(join(tmpdir(), 'harness-test-')), 'project');
  mkdirSync(dir);
  git(dir, 'init', '-q');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-q', '--allow-empty', '-m', 'init');
  return dir;
}

export function apply(dir, answers, env = {}) {
  const r = spawnSync('node', [APPLY, JSON.stringify(answers)], {
    cwd: dir,
    encoding: 'utf8',
    env: cleanEnv({ HARNESS_NO_INSTALL: '1', ...env }),
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const sha = (text) => createHash('sha256').update(text).digest('hex');

export function snapshot(dir) {
  const result = {};
  for (const file of walk(dir).sort()) {
    const rel = relative(dir, file).split('\\').join('/');
    let text = readFileSync(file, 'utf8');
    if (rel === '.claude/harness.json') {
      const json = JSON.parse(text);
      delete json.version;
      delete json.base;
      delete json.$comment;
      text = JSON.stringify(json);
    }
    result[rel] = sha(text);
  }
  return result;
}

export function golden(name, actual) {
  const file = join(here, 'golden', `${name}.json`);
  const text = JSON.stringify(actual, null, 2) + '\n';
  if (process.env.UPDATE_GOLDEN === '1') {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    return;
  }
  assert.ok(existsSync(file), `no golden file ${file}; run with UPDATE_GOLDEN=1`);
  assert.deepEqual(actual, JSON.parse(readFileSync(file, 'utf8')));
}
