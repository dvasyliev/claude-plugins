// The node stack: package.json is created, and the js modules that need a framework or a tsconfig stay out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { apply, makeProject, snapshot } from './helpers.mjs';

const PYPROJECT = '[project]\nname = "app"\nversion = "0.1.0"\n';
const ANSWERS = { stacks: ['python', 'node'], modules: ['core', 'types', 'ruff', 'oxlint', 'prettier', 'unit'], srcDirs: { python: ['app'], node: ['scripts'] } };
const read = (dir, path) => readFileSync(join(dir, path), 'utf8');
const typeCheck = (dir) => JSON.parse(read(dir, '.claude/harness.json')).checks.some((c) => c.name === 'types');

test('node with Python creates package.json and keeps its stacks', () => {
  const dir = makeProject({ 'pyproject.toml': PYPROJECT, 'scripts/a.mjs': 'export const a = 1;\n' });
  const r = apply(dir, ANSWERS);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /harness: created package.json for the node stack/);
  assert.equal(read(dir, 'package.json').startsWith(`{\n  "name": "${basename(dir)}",\n  "private": true`), true);
  assert.equal(JSON.parse(read(dir, 'package.json')).private, true);
  assert.deepEqual(JSON.parse(read(dir, '.claude/harness.json')).stacks, ['python', 'node']);
  assert.match(read(dir, '.prettierignore'), /\*\.mjs/);
  assert.match(read(dir, '.oxlintrc.json'), /import\/no-cycle/);
});

test('types adds no tsc check without tsconfig.json; with it, it does', () => {
  const without = makeProject({ 'pyproject.toml': PYPROJECT, 'scripts/a.mjs': '' });
  assert.equal(apply(without, ANSWERS).status, 0);
  assert.equal(typeCheck(without), false);
  const withTs = makeProject({ 'pyproject.toml': PYPROJECT, 'tsconfig.json': '{}', 'scripts/a.mjs': '' });
  assert.equal(apply(withTs, ANSWERS).status, 0);
  assert.equal(typeCheck(withTs), true);
});

test('node excludes react', () => {
  const dir = makeProject({ 'package.json': '{}' });
  const r = apply(dir, { stacks: ['node', 'react'], modules: ['core'] });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /excludes/);
});

test('a second run changes nothing', () => {
  const dir = makeProject({ 'pyproject.toml': PYPROJECT, 'scripts/a.mjs': '' });
  assert.equal(apply(dir, ANSWERS).status, 0);
  const before = snapshot(dir);
  assert.equal(apply(dir, {}).status, 0);
  assert.deepEqual(snapshot(dir), before);
  assert.equal(existsSync(join(dir, 'package.json')), true);
});

test('node is detected by its server framework, not by files a React project also has', () => {
  const { detect } = JSON.parse(readFileSync(new URL('../modules.json', import.meta.url), 'utf8')).stacks.node;
  assert.deepEqual(detect, { dependencies: ['express', 'fastify'] });
});

const EXPRESS_PKG = '{"name":"app","private":true,"dependencies":{"express":"5.1.0"}}';
const NODE_GLOB = '  - "**/*.{js,mjs,cjs,ts,mts,cts}"';

test('libraries: node gets the Node sections, for every JS file', () => {
  const dir = makeProject({ 'package.json': EXPRESS_PKG });
  const r = apply(dir, { stacks: ['node'], modules: ['core', 'oxlint', 'libraries'] });
  assert.equal(r.status, 0, r.stderr);
  const rule = read(dir, '.claude/rules/libraries.md');
  assert.equal(rule.startsWith(`---\npaths:\n${NODE_GLOB}\n---\n`), true);
  for (const heading of ['Validation', 'Dates and numbers', 'HTTP', 'Retries', 'HTTP mocks in tests']) assert.match(rule, new RegExp(`^## ${heading}$`, 'm'));
  assert.doesNotMatch(rule, /^## Forms$/m);
  assert.doesNotMatch(rule, /React|browser|server action/);
  assert.deepEqual(JSON.parse(read(dir, '.claude/harness.json')).libraries, { 'validation-node': 'zod', dates: 'date-fns', 'http-node': 'none', 'retry-node': 'p-retry', 'http-mocks-node': 'msw' });
  // The HTTP section has no library: the platform's fetch is the answer.
  assert.match(rule, /^## HTTP\n\n\*\*Platform:\*\* `fetch`.*\n\n## Retries$/m);
  assert.match(rule, /^\*\*Library:\*\* p-retry/m);
  assert.match(rule, /^\*\*Library:\*\* MSW/m);
});

test('libraries: node with Python loads for both, the Python sections after', () => {
  const dir = makeProject({ 'pyproject.toml': PYPROJECT, 'scripts/a.mjs': '' });
  const r = apply(dir, { ...ANSWERS, modules: [...ANSWERS.modules, 'libraries'] });
  assert.equal(r.status, 0, r.stderr);
  const rule = read(dir, '.claude/rules/libraries.md');
  assert.equal(rule.startsWith(`---\npaths:\n${NODE_GLOB}\n  - "**/*.py"\n---\n`), true);
  assert.ok(rule.indexOf('## Retries') < rule.indexOf('# Python'));
  assert.ok(rule.indexOf('# Python') < rule.indexOf('## Command line'));
});

test('node gets its resilience and unit test rules and the wshobson skills', () => {
  const dir = makeProject({ 'package.json': EXPRESS_PKG });
  const r = apply(dir, { stacks: ['node'], modules: ['core', 'oxlint', 'unit', 'resilience', 'best-practices'] });
  assert.equal(r.status, 0, r.stderr);
  assert.match(read(dir, '.claude/rules/external-requests.md'), /^paths:\n {2}- "\*\*\/\*\.\{js,mjs,cjs,ts\}"\n---$/m);
  assert.match(read(dir, '.claude/rules/external-requests.md'), /AbortSignal\.timeout\(/);
  assert.match(read(dir, '.claude/rules/external-requests.md'), /msw/);
  assert.doesNotMatch(read(dir, '.claude/rules/tests-unit.md'), /jsdom|Testing Library|src\/\*\*/);
  const { paths } = JSON.parse(read(dir, '.claude/harness.json'));
  for (const skill of ['nodejs-backend-patterns', 'modern-javascript-patterns', 'javascript-testing-patterns']) assert.ok(paths.includes(`.claude/skills/${skill}`), skill);
  assert.equal(paths.some((p) => p.includes('vercel') || p.includes('python-')), false);
});

test('unit brings the React test packages to React and Next.js only', async () => {
  const { effective } = await import('../tasks/lib/stacks.mjs');
  const catalog = JSON.parse(readFileSync(new URL('../modules.json', import.meta.url), 'utf8'));
  const devDeps = (stack) => effective(catalog.modules.unit, stack, catalog, {}).devDependencies;
  assert.deepEqual(devDeps('node'), ['vitest']);
  for (const stack of ['react', 'nextjs']) assert.deepEqual(devDeps(stack), ['vitest', 'jsdom', '@vitejs/plugin-react', '@testing-library/react', '@testing-library/dom']);
});

test('knip on node takes every JS file as an entry, so loose scripts are not unused files', () => {
  const dir = makeProject({ 'pyproject.toml': PYPROJECT, 'scripts/a.mjs': '' });
  assert.equal(apply(dir, { ...ANSWERS, modules: [...ANSWERS.modules, 'unused'] }).status, 0);
  const knip = JSON.parse(read(dir, 'knip.json'));
  assert.equal(knip.entry[0], '**/*.{js,mjs,cjs,ts,mts,cts}');
  assert.equal(knip.includeEntryExports, true);
  assert.equal(knip.ignoreDependencies.includes('@testing-library/react'), false);
});

test('node ignores node_modules, once', () => {
  const dir = makeProject({ 'pyproject.toml': PYPROJECT, 'scripts/a.mjs': '', '.gitignore': '.venv\n' });
  assert.equal(apply(dir, ANSWERS).status, 0);
  assert.match(read(dir, '.gitignore'), /^node_modules\/$/m);
  const has = makeProject({ 'package.json': EXPRESS_PKG, '.gitignore': 'node_modules/\n' });
  assert.equal(apply(has, { stacks: ['node'], modules: ['core', 'oxlint'] }).status, 0);
  assert.equal(read(has, '.gitignore'), 'node_modules/\n');
});

test('node with Python and no pyproject.toml fails before it writes package.json', () => {
  const dir = makeProject({ 'scripts/a.mjs': '' });
  const r = apply(dir, ANSWERS);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /pyproject\.toml is missing/);
  assert.equal(existsSync(join(dir, 'package.json')), false);
});
