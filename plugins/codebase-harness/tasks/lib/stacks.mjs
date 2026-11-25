// Resolves a module for each chosen stack: which stacks it applies to and its per-language / per-stack overrides.
import { isDeepStrictEqual } from "node:util";

const NAMED = ["checks", "fileChecks", "reports"];
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function checkStacks(catalog, stackIds) {
  if (!stackIds.length) throw new Error("no stack chosen");
  for (const id of stackIds) if (!catalog.stacks?.[id]) throw new Error(`unknown stack "${id}"`);
  for (const a of stackIds)
    for (const b of stackIds)
      if (catalog.stacks[a].excludes?.includes(b)) throw new Error(`stack "${a}" excludes "${b}"`);
}

const detectMatches = (detect, has, pkg) =>
  Object.entries(detect).some(([field, names]) =>
    names.some((name) => (field === "files" ? has(name) : name in (pkg[field] ?? {}))),
  );

// A module's stacks: its own `stacks`, else its group's (`null`: every stack).
export function applies(module, stackId, catalog, has, pkg) {
  const language = catalog.stacks[stackId].language;
  const stacks = module.stacks ?? catalog.groups?.[module.group]?.stacks;
  if (stacks && !stacks.includes(stackId) && !stacks.includes(language)) return false;
  return [module.by?.[language]?.detect, module.by?.[stackId]?.detect].every(
    (detect) => !detect || detectMatches(detect, has, pkg),
  );
}

// Old module names (`renamed`: a name or a list of names) to their new ones, followed through every rename,
// each name once. A name already being followed is kept as it is, so a loop ends.
export function renameModules(ids, renamed = {}) {
  const expand = (id, seen) => {
    if (!(id in renamed) || seen.has(id)) return [id];
    return [renamed[id]].flat().flatMap((next) => expand(next, new Set([...seen, id])));
  };
  return [...new Set(ids.flatMap((id) => expand(id, new Set())))];
}

export function mergeBy(a, b) {
  const out = { ...a };
  for (const [key, value] of Object.entries(b)) {
    const prev = out[key];
    if (NAMED.includes(key) && Array.isArray(prev) && Array.isArray(value)) {
      const merged = [...prev];
      for (const entry of value) {
        const i = merged.findIndex((e) => e.name === entry.name);
        if (i >= 0) merged[i] = entry;
        else merged.push(entry);
      }
      out[key] = merged;
    } else if (Array.isArray(prev) && Array.isArray(value)) {
      out[key] = [...prev];
      for (const item of value) if (!out[key].some((e) => isDeepStrictEqual(e, item))) out[key].push(item);
    } else if (isObject(prev) && isObject(value)) out[key] = mergeBy(prev, value);
    else out[key] = value;
  }
  return out;
}

const substitute = (node, dirs) => {
  if (typeof node === "string") return node.replaceAll("{srcDirs}", dirs);
  if (Array.isArray(node)) return node.map((n) => substitute(n, dirs));
  if (isObject(node)) return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, substitute(v, dirs)]));
  return node;
};

const joinDirs = (list) => [...new Set(list)].join(" ") || ".";

export function effective(module, stackId, catalog, srcDirs) {
  const { by, stacks, detect, ...own } = module;
  const language = catalog.stacks[stackId].language;
  const all = joinDirs(Object.values(srcDirs).flat());
  const mine = joinDirs(srcDirs[stackId] ?? []);
  let out = substitute(own, all);
  for (const layer of [by?.[language], by?.[stackId]]) {
    if (!layer) continue;
    const { detect: _detect, ...rest } = layer;
    out = mergeBy(out, substitute(rest, mine));
  }
  return out;
}

export function combine(perStack) {
  let out = {};
  const commands = {};
  const checks = {};
  for (const result of perStack) {
    for (const [name, script] of Object.entries(result.scripts ?? {})) {
      if (name in commands && commands[name] !== script.command) throw new Error(`script "${name}" differs between stacks`);
      commands[name] = script.command;
    }
    for (const key of NAMED) {
      for (const entry of result[key] ?? []) {
        const id = `${key}:${entry.name}`;
        if (id in checks && !isDeepStrictEqual(checks[id], entry)) throw new Error(`check "${entry.name}" differs between stacks`);
        checks[id] = entry;
      }
    }
    out = mergeBy(out, result);
  }
  return out;
}
