// The CI workflow's `node` step picks the file that names the project's Node version.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanEnv } from './helpers.mjs';

const ci = join(dirname(fileURLToPath(import.meta.url)), '..', 'modules/shared/ci/all/.github/workflows/ci.yml');

// The `run` block of the step with `id: node`: its lines, indented deeper than the `run:` key.
function nodeStepScript() {
  const lines = readFileSync(ci, 'utf8').split('\n');
  const id = lines.findIndex((l) => /^\s*- id: node\s*$/.test(l));
  const run = lines.findIndex((l, i) => i > id && /^\s*run: \|\s*$/.test(l));
  assert.ok(id >= 0 && run > id, 'ci.yml has a node step with a run block');
  const indent = lines[run].search(/\S/);
  const out = [];
  for (const l of lines.slice(run + 1)) {
    if (l.trim() !== '' && l.search(/\S/) <= indent) break;
    out.push(l.slice(indent + 2));
  }
  return out.join('\n');
}

function fileOutput(files) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-node-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  const output = join(dir, 'github-output.txt');
  writeFileSync(output, '');
  const r = spawnSync('bash', ['-e', '-c', nodeStepScript()], { cwd: dir, encoding: 'utf8', env: cleanEnv({ GITHUB_OUTPUT: output }) });
  assert.equal(r.status, 0, r.stderr);
  return readFileSync(output, 'utf8').trim();
}

test('the node step names the version file, in order', () => {
  assert.equal(fileOutput({ 'package.json': '{}', '.nvmrc': '24', '.node-version': '22' }), 'file=.nvmrc');
  assert.equal(fileOutput({ 'package.json': '{}', '.node-version': '22' }), 'file=.node-version');
  assert.equal(fileOutput({ 'package.json': '{}', '.tool-versions': 'python 3.12\nnodejs 22.1.0\n' }), 'file=.tool-versions');
  assert.equal(fileOutput({ 'package.json': '{}', 'mise.toml': '[tools]\nnode = "22"\n' }), 'file=mise.toml');
  assert.equal(fileOutput({ 'package.json': '{"engines":{"node":">=22"}}' }), 'file=package.json');
  assert.equal(fileOutput({ 'package.json': '{"volta":{"node":"22.1.0"}}' }), 'file=package.json');
});

test('the node step writes nothing when no file names a Node version', () => {
  assert.equal(fileOutput({ 'package.json': '{"name":"app"}' }), '');
  assert.equal(fileOutput({ 'package.json': '{}', '.tool-versions': 'python 3.12\n', 'mise.toml': '[tools]\npython = "3.12"\n' }), '');
});
