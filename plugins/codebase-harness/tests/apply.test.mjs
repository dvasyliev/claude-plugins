// apply.mjs answers: stacks in place of one framework, and the checks on them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renameModules } from '../tasks/lib/stacks.mjs';
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
  const old = { stacks: ['react'], modules: ['core', 'oxlint', 'unused', 'jscpd'] };
  const dir = makeProject({ 'package.json': REACT_PKG, '.claude/harness.json': JSON.stringify(old) });
  const r = apply(dir, {});
  assert.equal(r.status, 0, r.stderr);
  const json = harnessJson(dir);
  for (const id of ['knip', 'dupes', 'prettier', 'tsc']) assert.ok(json.modules.includes(id), id);
  for (const id of ['unused', 'jscpd', 'vulture', 'deptry']) assert.ok(!json.modules.includes(id), id);
  const names = json.checks.map((c) => c.name);
  for (const name of ['knip', 'dupes', 'types', 'format']) assert.ok(names.includes(name), name);
});

test('passed answers with old module names are renamed too', () => {
  const dir = makeProject({ 'package.json': REACT_PKG });
  const r = apply(dir, { stacks: ['react'], modules: ['core', 'oxlint', 'unused', 'jscpd', 'e2e'] });
  assert.equal(r.status, 0, r.stderr);
  const json = harnessJson(dir);
  for (const id of ['knip', 'dupes', 'playwright']) assert.ok(json.modules.includes(id), id);
  for (const id of ['unused', 'jscpd', 'e2e']) assert.ok(!json.modules.includes(id), id);
});

test('a react + python project with the old modules updates to the new ones that apply, and again changes nothing', () => {
  const old = {
    stacks: ['react', 'python'],
    srcDirs: { python: ['app'] },
    modules: ['core', 'oxlint', 'ruff', 'types', 'unused', 'unit', 'best-practices', 'resilience', 'e2e', 'imports'],
  };
  const dir = makeProject({
    'package.json': REACT_PKG,
    'pyproject.toml': '[project]\nname = "app"\nversion = "0.1.0"\n',
    '.claude/harness.json': JSON.stringify(old),
  });
  assert.equal(apply(dir, {}).status, 0);
  const json = harnessJson(dir);
  const expected = ['core', 'oxlint', 'ruff', 'file-size', 'prettier', 'tsc', 'basedpyright', 'knip', 'vulture', 'deptry', 'vitest', 'pytest',
    'react-practices', 'python-practices', 'playwright', 'import-linter'];
  assert.deepEqual([...json.modules].sort(), [...expected].sort());
  // The same checks and commands the old combined modules gave, the Python ones on the Python folders only.
  const commands = Object.fromEntries(json.checks.map((c) => [c.name, c.command]));
  assert.deepEqual(
    {
      types: commands.types, knip: commands.knip, test: commands.test,
      basedpyright: commands.basedpyright, vulture: commands.vulture, deptry: commands.deptry,
      imports: commands.imports, pytest: commands.pytest, 'file-size': commands['file-size'],
    },
    {
      types: 'npm run -s typecheck', knip: 'npm run -s knip', test: 'npm run -s test',
      basedpyright: 'uv run basedpyright', vulture: 'uv run vulture app --min-confidence 80',
      deptry: 'uv run deptry . --experimental-namespace-package', imports: 'uv run lint-imports',
      pytest: 'uv run pytest || [ $? -eq 5 ]', 'file-size': 'bash .claude/checks/file-size.sh app',
    },
  );
  const files = (d) => Object.fromEntries(readdirSync(d, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && !e.parentPath.includes('.git/') && !e.parentPath.endsWith('.git'))
    .map((e) => [join(e.parentPath, e.name), readFileSync(join(e.parentPath, e.name), 'utf8')]));
  const before = files(dir);
  const again = apply(dir, {});
  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(files(dir), before);
});

test('an old python project with core and ruff keeps the file-size check after an update', () => {
  const old = { stacks: ['python'], srcDirs: { python: ['app'] }, modules: ['core', 'ruff'] };
  const dir = makeProject({ 'pyproject.toml': '[project]\nname = "app"\nversion = "0.1.0"\n', '.claude/harness.json': JSON.stringify(old) });
  const r = apply(dir, {});
  assert.equal(r.status, 0, r.stderr);
  const json = harnessJson(dir);
  assert.ok(json.modules.includes('file-size'));
  assert.equal(json.checks.find((c) => c.name === 'file-size')?.command, 'bash .claude/checks/file-size.sh app');
});

test('a module whose group covers none of the chosen stacks is not written, even when passed', () => {
  const dir = makeProject({ 'package.json': REACT_PKG });
  const r = apply(dir, { stacks: ['react'], modules: ['core', 'oxlint', 'vulture', 'node-practices', 'next-docs'] });
  assert.equal(r.status, 0, r.stderr);
  const json = harnessJson(dir);
  for (const id of ['vulture', 'node-practices', 'next-docs']) assert.ok(!json.modules.includes(id), id);
  assert.ok(!json.checks.some((c) => c.name === 'vulture'));
});

test('every module is in a group, its files are in modules/<group>/<module>/, and every folder there is a module', () => {
  const plugin = join(dirname(fileURLToPath(import.meta.url)), '..');
  const catalog = JSON.parse(readFileSync(join(plugin, 'modules.json'), 'utf8'));
  for (const [id, m] of Object.entries(catalog.modules)) {
    assert.ok(m.group in catalog.groups, `${id}: group ${m.group}`);
    for (const group of Object.keys(catalog.groups))
      if (group !== m.group) assert.ok(!existsSync(join(plugin, 'modules', group, id)), `${id} is in modules/${group}/`);
  }
  for (const group of readdirSync(join(plugin, 'modules'))) {
    assert.ok(group in catalog.groups, `modules/${group}/ is no group`);
    for (const id of readdirSync(join(plugin, 'modules', group)))
      assert.equal(catalog.modules[id]?.group, group, `modules/${group}/${id}/ belongs to no module`);
  }
  for (const [old, next] of Object.entries(catalog.renamed))
    for (const id of [next].flat()) assert.ok(id in catalog.modules || id in catalog.renamed, `${old} -> ${id}`);
});

test('no renamed name is also a module, and every renamed name resolves to modules only', () => {
  const plugin = join(dirname(fileURLToPath(import.meta.url)), '..');
  const catalog = JSON.parse(readFileSync(join(plugin, 'modules.json'), 'utf8'));
  for (const old of Object.keys(catalog.renamed)) {
    assert.ok(!(old in catalog.modules), `${old} is renamed and a module`);
    for (const id of renameModules([old], catalog.renamed)) assert.ok(id in catalog.modules, `${old} -> ${id}`);
  }
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

test('only the hooks the harness writes are made executable, not the project files next to them', () => {
  const dir = makeProject({
    'pyproject.toml': '[project]\nname = "app"\nversion = "0.1.0"\n',
    '.claude/hooks/guard.py': 'print("project hook")\n',
    '.githooks/notes.txt': 'project notes\n',
  });
  const r = apply(dir, { stacks: ['python'], modules: ['core', 'ruff', 'commitlint'] });
  assert.equal(r.status, 0, r.stderr);
  const mode = (path) => statSync(join(dir, path)).mode & 0o777;
  assert.equal(mode('.claude/hooks/guard.py'), 0o644);
  assert.equal(mode('.githooks/notes.txt'), 0o644);
  assert.equal(mode('.claude/hooks/check-all.sh'), 0o755);
  assert.equal(mode('.githooks/commit-msg'), 0o755);
});

test('MCP args the harness added last time are replaced whole, in the harness order', () => {
  const dir = makeProject({ 'package.json': REACT_PKG });
  assert.equal(apply(dir, { stacks: ['react'], modules: ['core', 'oxlint', 'page-speed'] }).status, 0);
  // An earlier version added the server with @latest.
  const latest = ['-y', 'chrome-devtools-mcp@latest', '--isolated'];
  const json = harnessJson(dir);
  json.merged['.mcp.json'].mcpServers['chrome-devtools'].args = latest;
  writeFileSync(join(dir, '.claude/harness.json'), JSON.stringify(json));
  const mcp = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'));
  mcp.mcpServers['chrome-devtools'].args = latest;
  writeFileSync(join(dir, '.mcp.json'), JSON.stringify(mcp));
  const r = apply(dir, {});
  assert.equal(r.status, 0, r.stderr);
  const args = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8')).mcpServers['chrome-devtools'].args;
  assert.deepEqual(args, ['-y', 'chrome-devtools-mcp@1.12.0', '--isolated']);
});

test('every raw.githubusercontent.com download in the catalog names a tag or commit, not a branch', () => {
  const catalog = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'modules.json'), 'utf8');
  const urls = catalog.match(/https:\/\/raw\.githubusercontent\.com\/[^\s"]+/g) ?? [];
  assert.ok(urls.length > 0);
  for (const url of urls) assert.doesNotMatch(url.split('/')[5], /^(master|main|HEAD)$/, url);
});

test('ci writes the workflow; dependency-updates lists only the package managers of the chosen stacks', () => {
  const ecosystems = (dir) => [...readFileSync(join(dir, '.github/dependabot.yml'), 'utf8').matchAll(/package-ecosystem: (\S+)/g)].map((m) => m[1]);
  const pyproject = '[project]\nname = "app"\n';
  const both = makeProject({ 'package.json': REACT_PKG, 'pyproject.toml': pyproject });
  let r = apply(both, { stacks: ['react', 'python'], modules: ['core', 'oxlint', 'ruff', 'ci', 'dependency-updates'] });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(both, '.github/workflows/ci.yml')));
  assert.deepEqual(ecosystems(both), ['github-actions', 'npm', 'uv']);
  const python = makeProject({ 'pyproject.toml': pyproject });
  r = apply(python, { stacks: ['python'], modules: ['core', 'ruff', 'dependency-updates'] });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(ecosystems(python), ['github-actions', 'uv']);
  r = apply(python, { modules: ['core', 'ruff'] });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(join(python, '.github')), 'the file and its folders go with the module');
});
