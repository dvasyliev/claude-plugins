// The release script of the releases module, run in throwaway git repos with fake uv and pnpm on PATH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanEnv } from './helpers.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'modules', 'shared', 'releases', 'all', '.githooks', 'release.mjs');

// A repo with `files` committed (as `chore: init`), an optional tag on it, then `commits` ([subject, body?]).
function repo(files, { tag, commits = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'release-test-'));
  const bin = join(dir, '.bin');
  mkdirSync(bin);
  const fake = (name, body) => {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${bin}/${name}.log"\n${body}`);
    chmodSync(join(bin, name), 0o755);
  };
  fake('uv', `if [ "$1" = --version ]; then echo 'uv 0.7.0'; fi\nif [ "$1" = version ]; then sed -i.bak "s/^version = .*/version = \\"$2\\"/" pyproject.toml && rm pyproject.toml.bak; fi\n`);
  fake('pnpm', '');
  const env = cleanEnv({ PATH: `${bin}:${process.env.PATH}` });
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git('init', '-q');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.com');
  git('config', 'core.hooksPath', '/dev/null');
  writeFileSync(join(dir, '.gitignore'), '.bin\n');
  for (const [path, text] of Object.entries(files)) writeFileSync(join(dir, path), text);
  git('add', '-A');
  git('commit', '-q', '-m', 'chore: init');
  if (tag) git('tag', '-a', tag, '-m', tag);
  commits.forEach(([subject, body], i) => {
    writeFileSync(join(dir, `f${i}.txt`), `${i}\n`);
    git('add', '-A');
    git('commit', '-q', '-m', subject, ...(body ? ['-m', body] : []));
  });
  const run = () => {
    const r = spawnSync('node', [SCRIPT], { cwd: dir, encoding: 'utf8', env });
    return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
  };
  const read = (f) => readFileSync(join(dir, f), 'utf8');
  const log = (name) => (existsSync(join(bin, `${name}.log`)) ? readFileSync(join(bin, `${name}.log`), 'utf8') : '');
  return { dir, git, run, read, log };
}

const pkg = (version) => JSON.stringify({ name: 'app', ...(version ? { version } : {}) }, null, 2) + '\n';
const version = (p) => JSON.parse(p).version;

test('a feat since the last tag raises minor, writes the changelog, commits and tags', () => {
  const r = repo(
    { 'package.json': pkg('1.2.3'), 'package-lock.json': JSON.stringify({ name: 'app', version: '1.2.3', lockfileVersion: 3, packages: { '': { name: 'app', version: '1.2.3' } } }) + '\n' },
    { tag: 'v1.2.3', commits: [['feat: a'], ['fix: b'], ['docs: c']] },
  );
  const out = r.run();
  assert.deepEqual([out.status, out.stdout], [0, 'released v1.3.0']);
  assert.equal(version(r.read('package.json')), '1.3.0');
  assert.equal(version(r.read('package-lock.json')), '1.3.0');
  const changelog = r.read('CHANGELOG.md');
  assert.match(changelog, /^# Changelog\n\n## 1\.3\.0 \(/);
  assert.match(changelog, /### Features\n\n- a \(/);
  assert.match(changelog, /### Fixes\n\n- b \(/);
  assert.match(changelog, /### Other\n\n- c \(/);
  assert.equal(r.git('log', '-1', '--format=%s'), 'chore: release v1.3.0');
  assert.equal(r.git('cat-file', '-t', 'v1.3.0'), 'tag');
  assert.equal(r.git('rev-parse', 'v1.3.0^{commit}'), r.git('rev-parse', 'HEAD'));
  assert.equal(r.git('status', '--porcelain'), '');
});

test('breaking raises major, or minor below 1.0', () => {
  const a = repo({ 'package.json': pkg('1.2.3') }, { tag: 'v1.2.3', commits: [['feat!: x']] });
  assert.equal(a.run().stdout, 'released v2.0.0');
  const b = repo({ 'package.json': pkg('0.4.1') }, { tag: 'v0.4.1', commits: [['feat!: x']] });
  assert.equal(b.run().stdout, 'released v0.5.0');
  const c = repo({ 'package.json': pkg('1.2.3') }, { tag: 'v1.2.3', commits: [['fix: x', 'BREAKING CHANGE: y']] });
  assert.equal(c.run().stdout, 'released v2.0.0');
  assert.match(c.read('CHANGELOG.md'), /### Breaking\n\n- x \(/);
});

test('without a tag every commit counts, and no version starts from 0.0.0', () => {
  const r = repo({ 'package.json': pkg() }, { commits: [['fix: a'], ['feat: b']] });
  assert.equal(r.run().stdout, 'released v0.1.0');
  assert.equal(version(r.read('package.json')), '0.1.0');
  const changelog = r.read('CHANGELOG.md');
  assert.match(changelog, /- a \(/);
  assert.match(changelog, /- b \(/);
});

test('release commits do not count, and no commits means nothing to release', () => {
  const r = repo({ 'package.json': pkg('1.0.0') }, { tag: 'v1.0.0', commits: [['chore: release v1.0.1']] });
  assert.deepEqual([r.run().status, r.run().stdout], [0, 'nothing to release']);
  const s = repo({ 'package.json': pkg('1.0.0') }, { tag: 'v1.0.0' });
  assert.deepEqual([s.run().status, s.run().stdout], [0, 'nothing to release']);
});

test('python version is written with uv version', () => {
  const r = repo({ 'pyproject.toml': '[project]\nname = "app"\nversion = "0.1.0"\n' }, { tag: 'v0.1.0', commits: [['fix: a']] });
  assert.equal(r.run().stdout, 'released v0.1.1');
  assert.match(r.log('uv'), /^uv version 0\.1\.1$/m);
  assert.match(r.read('pyproject.toml'), /version = "0\.1\.1"/);
  assert.equal(r.git('status', '--porcelain'), '');
});

test('both stacks with different versions stop', () => {
  const r = repo({ 'package.json': pkg('1.0.0'), 'pyproject.toml': '[project]\nname = "app"\nversion = "1.1.0"\n' }, { tag: 'v1.0.0', commits: [['fix: a']] });
  const head = r.git('rev-parse', 'HEAD');
  const out = r.run();
  assert.equal(out.status, 1);
  assert.match(out.stderr, /^release: .*1\.0\.0.*1\.1\.0/);
  assert.equal(r.git('rev-parse', 'HEAD'), head);
  assert.equal(r.git('status', '--porcelain'), '');
});

test('a dynamic python version stops and changes nothing', () => {
  const r = repo({ 'pyproject.toml': '[project]\nname = "app"\ndynamic = ["version"]\n' }, { commits: [['fix: a']] });
  const head = r.git('rev-parse', 'HEAD');
  const out = r.run();
  assert.equal(out.status, 1);
  assert.match(out.stderr, /^release: /);
  assert.equal(r.git('rev-parse', 'HEAD'), head);
  assert.equal(r.git('status', '--porcelain'), '');
  assert.equal(r.log('uv'), '');
});

test('a pnpm project uses pnpm version', () => {
  const r = repo({ 'package.json': pkg('1.0.0'), 'pnpm-lock.yaml': 'lockfileVersion: 9\n' }, { tag: 'v1.0.0', commits: [['fix: a']] });
  r.run();
  assert.match(r.log('pnpm'), /^pnpm version 1\.0\.1 --no-git-tag-version --allow-same-version$/m);
});

test('a package.json without version next to pyproject.toml is skipped', () => {
  const r = repo({ 'package.json': pkg(), 'pyproject.toml': '[project]\nname = "app"\nversion = "0.2.0"\n' }, { tag: 'v0.2.0', commits: [['fix: a']] });
  assert.equal(r.run().stdout, 'released v0.2.1');
  assert.equal(r.read('package.json'), pkg());
  assert.match(r.read('pyproject.toml'), /version = "0\.2\.1"/);
});

test('unrelated staged and unstaged files stay out of the release commit', () => {
  const r = repo({ 'package.json': pkg('1.0.0'), 'a.txt': 'a\n', 'b.txt': 'b\n' }, { tag: 'v1.0.0', commits: [['fix: a']] });
  writeFileSync(join(r.dir, 'a.txt'), 'changed\n');
  writeFileSync(join(r.dir, 'b.txt'), 'changed\n');
  r.git('add', 'a.txt');
  assert.equal(r.run().stdout, 'released v1.0.1');
  assert.equal(r.git('show', '--name-only', '--format=', 'HEAD').split('\n').sort().join(), 'CHANGELOG.md,package.json');
  assert.equal(r.git('status', '--porcelain'), 'M  a.txt\n M b.txt');
});

test('a dirty file the release touches stops it and changes nothing', () => {
  for (const file of ['package.json', 'CHANGELOG.md']) {
    const r = repo({ 'package.json': pkg('1.0.0'), 'CHANGELOG.md': '# Changelog\n\n' }, { tag: 'v1.0.0', commits: [['fix: a']] });
    writeFileSync(join(r.dir, file), r.read(file) + '\n');
    const head = r.git('rev-parse', 'HEAD');
    const out = r.run();
    assert.equal(out.status, 1);
    assert.equal(out.stderr, `release: ${file} has uncommitted changes; commit or stash them first`);
    assert.equal(r.git('rev-parse', 'HEAD'), head);
    assert.equal(r.git('tag', '--list'), 'v1.0.0');
    assert.equal(r.git('status', '--porcelain'), `M ${file}`);
  }
});

test('a commit hook that rejects the release gives a release message and exit 1', () => {
  const r = repo({ 'package.json': pkg('1.0.0') }, { tag: 'v1.0.0', commits: [['fix: a']] });
  mkdirSync(join(r.dir, '.hooks'));
  writeFileSync(join(r.dir, '.hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n');
  chmodSync(join(r.dir, '.hooks', 'pre-commit'), 0o755);
  r.git('config', 'core.hooksPath', join(r.dir, '.hooks'));
  const out = r.run();
  assert.equal(out.status, 1);
  assert.match(out.stderr, /release: commit failed; the version files are changed but not committed/);
  assert.doesNotMatch(out.stderr, /at .*release\.mjs/);
  assert.equal(r.git('tag', '--list'), 'v1.0.0');
});
