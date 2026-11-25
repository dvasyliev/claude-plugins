import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applies, checkStacks, combine, effective, mergeBy, renameModules } from '../tasks/lib/stacks.mjs';

const cat = {
  stacks: {
    react: { language: 'js', srcDirs: ['src'] },
    nextjs: { language: 'js', excludes: ['react'], srcDirs: ['app'] },
    python: { language: 'python', srcDirs: ['app'] },
    node: { language: 'js', excludes: ['react', 'nextjs'], srcDirs: [] },
  },
  groups: {
    shared: { stacks: null },
    js: { stacks: ['react', 'nextjs', 'node'] },
    web: { stacks: ['react', 'nextjs'] },
    python: { stacks: ['python'] },
  },
};

test('checkStacks', () => {
  assert.throws(() => checkStacks(cat, ['react', 'nextjs']), /excludes/);
  checkStacks(cat, ['nextjs', 'python']);
  assert.throws(() => checkStacks(cat, ['vue']), /unknown stack/);
  assert.throws(() => checkStacks(cat, []));
});

test('applies', () => {
  assert.equal(applies({ stacks: ['js'] }, 'python', cat, () => false, {}), false);
  assert.equal(applies({ stacks: ['js'] }, 'react', cat, () => false, {}), true);
  assert.equal(applies({ stacks: ['python'] }, 'python', cat, () => false, {}), true);
  assert.equal(applies({}, 'python', cat, () => false, {}), true);
  const m = { by: { python: { detect: { files: ['tsconfig.json'] } } } };
  assert.equal(applies(m, 'python', cat, () => false, {}), false);
  assert.equal(applies(m, 'python', cat, (p) => p === 'tsconfig.json', {}), true);
  const d = { by: { react: { detect: { dependencies: ['x'] } } } };
  assert.equal(applies(d, 'react', cat, () => false, { dependencies: { x: '1' } }), true);
  assert.equal(applies(d, 'react', cat, () => false, {}), false);
});

test('applies: a module applies to its group\'s stacks unless it names its own', () => {
  const no = () => false;
  assert.equal(applies({ group: 'python' }, 'react', cat, no, {}), false);
  assert.equal(applies({ group: 'js' }, 'node', cat, no, {}), true);
  assert.equal(applies({ group: 'shared' }, 'python', cat, no, {}), true);
  assert.equal(applies({ group: 'web' }, 'node', cat, no, {}), false);
  assert.equal(applies({ group: 'js', stacks: ['react'] }, 'node', cat, no, {}), false);
  const tsc = { group: 'js', by: { node: { detect: { files: ['tsconfig.json'] } } } };
  assert.equal(applies(tsc, 'node', cat, no, {}), false);
  assert.equal(applies(tsc, 'react', cat, no, {}), true);
});

test('renameModules follows every rename, once each, and ends on a loop', () => {
  const renamed = { types: ['tsc', 'basedpyright'], old: 'types', jscpd: 'dupes', a: 'b', b: ['a', 'c'] };
  assert.deepEqual(renameModules(['core', 'old', 'types', 'jscpd'], renamed), ['core', 'tsc', 'basedpyright', 'dupes']);
  assert.deepEqual(renameModules(['a'], renamed), ['a', 'c']);
  assert.deepEqual(renameModules(['x'], undefined), ['x']);
});

test('effective', () => {
  const m = {
    stacks: ['js', 'python'],
    scripts: { d: { command: 'jscpd {srcDirs}' } },
    by: { python: { detect: {}, scripts: { v: { command: 'vulture {srcDirs}' } } } },
  };
  const r = effective(m, 'python', cat, { react: ['src'], python: ['app', 'tools'] });
  assert.equal(r.scripts.d.command, 'jscpd src app tools');
  assert.equal(r.scripts.v.command, 'vulture app tools');
  assert.deepEqual(Object.keys(r), ['scripts']);
  assert.equal(effective({ x: '{srcDirs}' }, 'react', cat, { react: [] }).x, '.');
});

test('mergeBy', () => {
  assert.deepEqual(
    mergeBy({ checks: [{ name: 'a', x: 1 }] }, { checks: [{ name: 'a', x: 2 }, { name: 'b' }] }).checks,
    [{ name: 'a', x: 2 }, { name: 'b' }],
  );
  assert.deepEqual(mergeBy({ l: ['a'], o: { p: 1 } }, { l: ['a', 'b'], o: { q: 2 } }), { l: ['a', 'b'], o: { p: 1, q: 2 } });
});

test('combine', () => {
  assert.throws(() => combine([{ scripts: { t: { command: 'tsc' } } }, { scripts: { t: { command: 'pyright' } } }]), /script "t" differs/);
  assert.throws(() => combine([{ checks: [{ name: 'c', command: 'a' }] }, { checks: [{ name: 'c', command: 'b' }] }]), /check "c" differs/);
  assert.deepEqual(combine([{ checks: [{ name: 'c' }] }, { checks: [{ name: 'c' }, { name: 'd' }] }]).checks, [{ name: 'c' }, { name: 'd' }]);
});
