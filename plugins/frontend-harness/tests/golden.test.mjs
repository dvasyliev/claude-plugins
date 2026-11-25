// Freezes what apply.mjs writes for a React and a Next.js project with every module, so a
// change that alters the output shows up as a golden diff.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_NEXT, ALL_REACT, NEXT_PKG, REACT_PKG, apply, golden, makeProject, snapshot } from './helpers.mjs';

for (const [framework, pkg, modules] of [
  ['react', REACT_PKG, ALL_REACT],
  ['nextjs', NEXT_PKG, ALL_NEXT],
]) {
  test(`apply.mjs output for ${framework} matches the golden`, () => {
    const dir = makeProject({ 'package.json': pkg });
    const r = apply(dir, { stacks: [framework], modules });
    assert.equal(r.status, 0, r.stderr);
    golden(framework, snapshot(dir));
  });
}
