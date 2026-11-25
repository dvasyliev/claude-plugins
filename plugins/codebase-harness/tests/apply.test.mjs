// apply.mjs answers: stacks in place of one framework, and the checks on them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

// A fake `npm` on PATH logs its arguments instead of installing.
function fakeNpm() {
  const bin = mkdtempSync(join(tmpdir(), 'harness-bin-'));
  symlinkSync(process.execPath, join(bin, 'node'));
  const log = join(bin, 'npm.log');
  writeFileSync(join(bin, 'npm'), `#!/bin/sh\necho "$@" >> "${log}"\n`);
  chmodSync(join(bin, 'npm'), 0o755);
  return { PATH: `${bin}:/usr/bin:/bin`, log };
}

test('size-limit and its file plugin install as one pinned pair, and not again once the project has them', () => {
  const answers = { stacks: ['react'], modules: ['core', 'oxlint', 'page-speed'] };
  const dir = makeProject({ 'package.json': REACT_PKG });
  const npm = fakeNpm();
  const r = apply(dir, answers, { PATH: npm.PATH, HARNESS_NO_INSTALL: '' });
  assert.equal(r.status, 0, r.stderr);
  const install = readFileSync(npm.log, 'utf8');
  assert.match(install, / size-limit@14\.3\.0\b/);
  assert.match(install, / @size-limit\/file@14\.3\.0\b/);
  const pkg = JSON.parse(REACT_PKG);
  pkg.devDependencies = { ...pkg.devDependencies, 'size-limit': '^14.3.0', '@size-limit/file': '^14.3.0' };
  const has = makeProject({ 'package.json': JSON.stringify(pkg) });
  const again = fakeNpm();
  assert.equal(apply(has, answers, { PATH: again.PATH, HARNESS_NO_INSTALL: '' }).status, 0);
  const second = existsSync(again.log) ? readFileSync(again.log, 'utf8') : '';
  assert.doesNotMatch(second, /size-limit/);
});

test('every npx -y in the catalog and the module files names an exact version', () => {
  const plugin = join(dirname(fileURLToPath(import.meta.url)), '..');
  const files = [join(plugin, 'modules.json'), ...readdirSync(join(plugin, 'modules'), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile()).map((d) => join(d.parentPath, d.name))];
  const pinned = /^(@[^/\s]+\/)?[^@\s]+@\d+\.\d+\.\d+$/;
  let seen = 0;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    // `npx -y <pkg>`, `npx -y -p <pkg> -p <pkg>`, and an MCP server's "args": ["-y", "<pkg>"].
    for (const [, flags] of text.matchAll(/npx -y((?: -p \S+)+| [^\s<"]+)/g)) {
      for (const pkg of flags.trim().split(/\s+/).filter((w) => w !== '-p')) {
        seen++;
        assert.match(pkg, pinned, `${file}: npx -y ${pkg}`);
      }
    }
    for (const [, pkg] of text.matchAll(/\["-y", "([^"]+)"/g)) {
      seen++;
      assert.match(pkg, pinned, `${file}: args -y ${pkg}`);
    }
  }
  assert.ok(seen > 10, `only ${seen} npx calls found`);
});

test('the old frontend-harness .gitignore header is replaced in place by the new one', () => {
  const dir = makeProject({
    'package.json': REACT_PKG,
    '.gitignore': '# Added by the frontend-harness plugin\n/test-results/\n',
  });
  const r = apply(dir, { stacks: ['react'], modules: ['core', 'oxlint', 'e2e'] });
  assert.equal(r.status, 0, r.stderr);
  const text = readFileSync(join(dir, '.gitignore'), 'utf8');
  assert.equal(text.split('# Added by the codebase-harness plugin').length, 2);
  assert.ok(!text.includes('frontend-harness'));
  assert.equal(text.split('/test-results/').length, 2);
});

test('a project script under another extension is not the harness file; a config under another extension is', () => {
  const dir = makeProject({
    'pyproject.toml': '[project]\nname = "app"\nversion = "0.1.0"\n',
    '.claude/hooks/check-all.py': 'print("project hook")\n',
    'commitlint.config.js': 'module.exports = {};\n',
  });
  const r = apply(dir, { stacks: ['python'], modules: ['core', 'ruff', 'commitlint'] });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(dir, '.claude/hooks/check-all.sh')));
  assert.equal(readFileSync(join(dir, '.claude/hooks/check-all.py'), 'utf8'), 'print("project hook")\n');
  assert.doesNotMatch(r.stdout, /check-all/);
  assert.equal(existsSync(join(dir, 'commitlint.config.mjs')), false);
  assert.match(r.stdout, /commitlint\.config\.mjs: the project has it as commitlint\.config\.js/);
});
