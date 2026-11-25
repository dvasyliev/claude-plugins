// The python stack: dev dependencies read from pyproject.toml, and apply.mjs without package.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { missingDevDeps } from '../tasks/lib/python.mjs';
import { REACT_PKG, apply, cleanEnv, makeProject, snapshot } from './helpers.mjs';

const harnessJson = (dir) => JSON.parse(readFileSync(join(dir, '.claude/harness.json'), 'utf8'));
const PYPROJECT = '[project]\nname = "app"\nversion = "0.1.0"\n';

test('missingDevDeps finds the names the dev group lacks', () => {
  const text = '[dependency-groups]\ndev = ["ruff>=0.17", "Basedpyright"]';
  assert.deepEqual(missingDevDeps(text, ['ruff', 'basedpyright', 'pytest']), ['pytest']);
});

test('missingDevDeps reads a requirement with escaped quotes in its marker', () => {
  const text = '[dependency-groups]\ndev = ["ruff; python_version >= \\"3.10\\"", "pytest"]';
  assert.deepEqual(missingDevDeps(text, ['ruff', 'pytest', 'vulture']), ['vulture']);
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

test('a python-only project needs no package.json and no port', () => {
  const dir = makeProject({ 'pyproject.toml': PYPROJECT });
  const r = apply(dir, { stacks: ['python'], modules: ['core', 'ruff'] });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(join(dir, 'package.json')), false);
  const json = harnessJson(dir);
  assert.deepEqual(json.stacks, ['python']);
  assert.equal('port' in json, false);
  assert.doesNotMatch(readFileSync(join(dir, '.claude/rules/harness.md'), 'utf8'), /run dev/);
});

test('a pnpm React and Python project runs js checks through pnpm and Python ones through uv', () => {
  const dir = makeProject({ 'package.json': REACT_PKG, 'pnpm-lock.yaml': '', 'pyproject.toml': PYPROJECT });
  const r = apply(dir, { stacks: ['react', 'python'], modules: ['core', 'oxlint', 'ruff', 'types'], srcDirs: { python: ['app'] } });
  assert.equal(r.status, 0, r.stderr);
  const { checks, fileChecks } = harnessJson(dir);
  const python = ['basedpyright', 'ruff-format', 'ruff'];
  for (const c of [...checks, ...fileChecks]) {
    const prefix = c.name === 'file-size' ? 'bash ' : python.includes(c.name) ? 'uv run ' : 'pnpm run -s ';
    assert.ok(c.command.startsWith(prefix), `${c.name}: ${c.command}`);
  }
  assert.deepEqual(checks.map((c) => c.name).filter((n) => n === 'file-size' || python.includes(n)), [...python.slice(0, 1), 'ruff-format', 'ruff', 'file-size']);
  assert.ok(checks.some((c) => c.name === 'types' && c.command === 'pnpm run -s typecheck'));
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.check, '.claude/hooks/check-all.sh --force');
  assert.equal('ruff' in pkg.scripts, false);
});

const PY_ANSWERS = { stacks: ['python'], modules: ['core', 'ruff', 'types'], srcDirs: { python: ['app'] } };

test('python checks: ruff and basedpyright, in catalog order, and a second run changes nothing', () => {
  const dir = makeProject({ 'pyproject.toml': PYPROJECT });
  const r = apply(dir, PY_ANSWERS);
  assert.equal(r.status, 0, r.stderr);
  const { checks, fileChecks } = harnessJson(dir);
  assert.deepEqual(checks.map((c) => c.name), ['basedpyright', 'ruff-format', 'ruff', 'file-size']);
  assert.match(checks.at(-1).command, /file-size\.sh app$/);
  assert.deepEqual(fileChecks.map((c) => [c.name, c.command, c.blocking, c.extensions]), [
    // Lint fixes first, so the format after them leaves the file formatted.
    ['ruff', 'uv run ruff check --fix --force-exclude', true, ['py']],
    ['ruff-format', 'uv run ruff format', false, ['py']],
  ]);
  for (const f of ['ruff.toml', 'pyrightconfig.json', '.claude/rules/python.md', '.claude/checks/file-size.sh']) assert.ok(existsSync(join(dir, f)), f);
  const before = snapshot(dir);
  assert.equal(apply(dir, {}).status, 0);
  assert.deepEqual(snapshot(dir), before);
});

test('harness.md lists the direct ruff script', () => {
  const dir = makeProject({ 'pyproject.toml': PYPROJECT });
  assert.equal(apply(dir, PY_ANSWERS).status, 0);
  assert.match(readFileSync(join(dir, '.claude/rules/harness.md'), 'utf8'), /^uv run ruff check \.  # Ruff lint$/m);
});

test('settings in pyproject.toml that a harness file now overrides are reported', () => {
  const dir = makeProject({ 'pyproject.toml': PYPROJECT + '\n[tool.ruff]\nline-length = 100\n\n[tool.basedpyright]\n' });
  const r = apply(dir, PY_ANSWERS);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[tool\.ruff\].*ruff\.toml/);
  assert.match(r.stdout, /\[tool\.basedpyright\].*pyrightconfig\.json/);
});

test('coverage settings in pyproject.toml that .coveragerc now overrides are reported', () => {
  const dir = makeProject({ 'pyproject.toml': PYPROJECT + '\n[tool.coverage.report]\nfail_under = 50\n' });
  const r = apply(dir, { ...PY_ANSWERS, modules: [...PY_ANSWERS.modules, 'unit'] });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[tool\.coverage\].*\.coveragerc/);
});

test('python needs a pyproject.toml in the folder', () => {
  const dir = makeProject({ 'README.md': '' });
  const r = apply(dir, PY_ANSWERS);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /pyproject\.toml is missing; run this in the project folder/);
});

test('file-size.sh lists each .py file over 500 lines', () => {
  const dir = makeProject({ 'pyproject.toml': PYPROJECT });
  assert.equal(apply(dir, PY_ANSWERS).status, 0);
  mkdirSync(join(dir, 'app'));
  const run = () => spawnSync('bash', ['.claude/checks/file-size.sh', 'app'], { cwd: dir, encoding: 'utf8', env: cleanEnv() });
  writeFileSync(join(dir, 'app/big.py'), 'x = 1\n'.repeat(500));
  assert.equal(run().status, 0);
  writeFileSync(join(dir, 'app/big.py'), 'x = 1\n'.repeat(501));
  const r = run();
  assert.equal(r.status, 1);
  assert.equal(r.stdout.trim(), 'app/big.py: 501 lines, limit 500');
});

// The uv path: a fake `uv` on PATH logs its arguments. A python-only project needs no npm install.
function fakeBin({ uv }) {
  const bin = mkdtempSync(join(tmpdir(), 'harness-bin-'));
  symlinkSync(process.execPath, join(bin, 'node'));
  const log = join(bin, 'uv.log');
  if (uv) {
    writeFileSync(join(bin, 'uv'), `#!/bin/sh\necho "$@" >> "${log}"\n`);
    chmodSync(join(bin, 'uv'), 0o755);
  }
  return { PATH: `${bin}:/usr/bin:/bin`, log };
}
const logged = (log) => (existsSync(log) ? readFileSync(log, 'utf8') : '');

test('without uv on PATH the install stops with a message', () => {
  const dir = makeProject({ 'pyproject.toml': PYPROJECT });
  const { PATH } = fakeBin({ uv: false });
  const r = apply(dir, PY_ANSWERS, { PATH, HARNESS_NO_INSTALL: '' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /harness: uv is not installed; the python stack needs it: https:\/\/docs\.astral\.sh\/uv\//);
});

test('uv adds the dev dependencies the project lacks, and nothing when it has them all', () => {
  const dir = makeProject({ 'pyproject.toml': PYPROJECT });
  const { PATH, log } = fakeBin({ uv: true });
  const r = apply(dir, PY_ANSWERS, { PATH, HARNESS_NO_INSTALL: '' });
  assert.equal(r.status, 0, r.stderr);
  const calls = logged(log).trim().split('\n');
  const add = calls.find((c) => c.startsWith('add --dev'));
  assert.ok(add && /\bruff\b/.test(add) && /\bbasedpyright\b/.test(add), calls.join('|'));
  const full = makeProject({ 'pyproject.toml': PYPROJECT + '\n[dependency-groups]\ndev = ["ruff", "basedpyright"]\n' });
  const second = fakeBin({ uv: true });
  assert.equal(apply(full, PY_ANSWERS, { PATH: second.PATH, HARNESS_NO_INSTALL: '' }).status, 0);
  assert.equal(/\badd\b/.test(logged(second.log)), false);
});

const TEST_MODULES = ['core', 'ruff', 'types', 'unit', 'unused', 'dupes'];

test('python-only: pytest, vulture, deptry, jscpd through npx, and the reports', () => {
  const dir = makeProject({ 'pyproject.toml': PYPROJECT });
  const r = apply(dir, { stacks: ['python'], modules: TEST_MODULES, srcDirs: { python: ['app', 'tools'] } });
  assert.equal(r.status, 0, r.stderr);
  const { checks, reports } = harnessJson(dir);
  const command = (name) => checks.find((c) => c.name === name)?.command;
  // Code only: no Markdown, HTML, CSS or JSON (.claude/harness.json sits in .claude/, a source folder when the
  // project keeps scripts there).
  assert.equal(command('dupes'), 'npx -y jscpd@5.4.3 app tools --threshold 0 --reporters console --format "javascript,typescript,jsx,tsx,python"');
  assert.equal(command('vulture'), 'uv run vulture app tools --min-confidence 80');
  assert.equal(command('deptry'), 'uv run deptry . --experimental-namespace-package');
  assert.equal(command('pytest'), 'uv run pytest || [ $? -eq 5 ]');
  assert.equal(command('test'), undefined);
  assert.deepEqual(reports.map((x) => x.name), ['ruff-strict', 'coverage']);
  for (const f of ['pytest.ini', '.coveragerc', '.claude/rules/tests-python.md']) assert.ok(existsSync(join(dir, f)), f);
  assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /^\/\.coverage$/m);
  assert.equal(existsSync(join(dir, 'package.json')), false);
});

test('imports runs lint-imports on python only', () => {
  const dir = makeProject({ 'pyproject.toml': PYPROJECT });
  assert.equal(apply(dir, { stacks: ['python'], modules: ['core', 'ruff', 'imports'] }).status, 0);
  assert.equal(harnessJson(dir).checks.find((c) => c.name === 'imports').command, 'uv run lint-imports');
  const react = makeProject({ 'package.json': REACT_PKG });
  const r = apply(react, { stacks: ['react'], modules: ['core', 'oxlint', 'imports'] });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(harnessJson(react).modules.includes('imports'), false);
  assert.equal('reports' in harnessJson(react), false);
});

test('React and Python: dupes is a package.json script covering both stacks, tests keep their names', () => {
  const dir = makeProject({ 'package.json': REACT_PKG, 'pyproject.toml': PYPROJECT });
  const r = apply(dir, { stacks: ['react', 'python'], modules: [...TEST_MODULES, 'oxlint'], srcDirs: { python: ['app', 'tools'] } });
  assert.equal(r.status, 0, r.stderr);
  const { checks } = harnessJson(dir);
  assert.equal(checks.find((c) => c.name === 'dupes').command, 'npm run -s dupes');
  assert.equal(checks.find((c) => c.name === 'test').command, 'npm run -s test');
  assert.equal(checks.find((c) => c.name === 'pytest').command, 'uv run pytest || [ $? -eq 5 ]');
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.dupes, /src app tools/);
  assert.equal('pytest' in pkg.scripts, false);
});

test('libraries: python-only gets the Python sections only, React and Python get both', () => {
  const rule = (dir) => readFileSync(join(dir, '.claude/rules/libraries.md'), 'utf8');
  const dir = makeProject({ 'pyproject.toml': PYPROJECT });
  const r = apply(dir, { stacks: ['python'], modules: ['core', 'ruff', 'libraries'], srcDirs: { python: ['app'] } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(rule(dir), /^## HTTP$/m);
  assert.doesNotMatch(rule(dir), /^## Forms$/m);
  assert.match(rule(dir), /^  - "\*\*\/\*\.py"$/m);
  assert.doesNotMatch(rule(dir), /React/);
  assert.deepEqual(Object.keys(harnessJson(dir).libraries), ['http', 'retry', 'http-mocks', 'cli', 'validation-python']);
  const both = makeProject({ 'package.json': REACT_PKG, 'pyproject.toml': PYPROJECT });
  const r2 = apply(both, { stacks: ['react', 'python'], modules: ['core', 'oxlint', 'ruff', 'libraries'], srcDirs: { python: ['app'] }, libraries: { http: 'httpx' } });
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(rule(both), /^## Forms$/m);
  assert.match(rule(both), /^\*\*Library:\*\* HTTPX/m);
  assert.match(rule(both), /^\*\*Library:\*\* RESPX/m);
  // The rule loads for Python files too, and the Python sections come after the JS ones, under their own heading.
  assert.match(rule(both), /^paths:\n {2}- "src\/\*\*"\n {2}- "app\/\*\*"\n {2}- "lib\/\*\*"\n {2}- "\*\*\/\*\.py"\n---$/m);
  const at = (heading) => rule(both).search(new RegExp(`^${heading}$`, 'm'));
  assert.ok(at('## Forms') < at('## Working on the platform alone'));
  assert.ok(at('## Working on the platform alone') < at('# Python'));
  assert.ok(at('# Python') < at('## HTTP'));
  assert.ok(at('## Forms') >= 0 && at('# Python') >= 0);
});

test('pytest passes with no tests collected (exit 5) and fails on a failing test', () => {
  const dir = makeProject({ 'pyproject.toml': PYPROJECT });
  assert.equal(apply(dir, { stacks: ['python'], modules: ['core', 'ruff', 'unit'] }).status, 0);
  const { command } = harnessJson(dir).checks.find((c) => c.name === 'pytest');
  const run = (code) => {
    const bin = mkdtempSync(join(tmpdir(), 'harness-bin-'));
    writeFileSync(join(bin, 'uv'), `#!/bin/sh\nexit ${code}\n`);
    chmodSync(join(bin, 'uv'), 0o755);
    return spawnSync('bash', ['-c', command], { cwd: dir, env: cleanEnv({ PATH: `${bin}:/usr/bin:/bin` }) }).status;
  };
  assert.equal(run(0), 0);
  assert.equal(run(5), 0);
  assert.notEqual(run(1), 0);
});

test('an update that passes only the python srcDirs keeps the react ones', () => {
  const dir = makeProject({ 'package.json': REACT_PKG, 'pyproject.toml': PYPROJECT });
  const r = apply(dir, { stacks: ['react', 'python'], modules: ['core', 'oxlint', 'ruff', 'dupes'], srcDirs: { react: ['web'], python: ['app'] } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(apply(dir, { srcDirs: { python: ['app', 'tools'] } }).status, 0);
  assert.deepEqual(harnessJson(dir).srcDirs, { react: ['web'], python: ['app', 'tools'] });
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.dupes, /jscpd web app tools /);
});

test('file-size checks the python folders only', () => {
  const dir = makeProject({ 'package.json': REACT_PKG, 'pyproject.toml': PYPROJECT });
  const r = apply(dir, { stacks: ['react', 'python'], modules: ['core', 'oxlint', 'ruff'], srcDirs: { react: ['web'], python: ['app'] } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(harnessJson(dir).checks.find((c) => c.name === 'file-size').command, 'bash .claude/checks/file-size.sh app');
});
