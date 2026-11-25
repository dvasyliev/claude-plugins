#!/usr/bin/env node
// Writes the chosen modules (modules.json, modules/) into the project in the current folder.
// Usage: node apply.mjs '{"stacks": ["nextjs"], "modules": [...], "skipChecks": [...], "docsLanguage": "English"}'
// An answer left out keeps its value from the last run (.claude/harness.json).
import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { missingDevDeps } from "./lib/python.mjs";
import { applies, checkStacks, combine, effective, renameModules } from "./lib/stacks.mjs";

const root = join(import.meta.dirname, "..");
const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback);
const writeJson = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
const old = readJson(".claude/harness.json", {});
// Answers from before stacks name one `framework`; it becomes `stacks: [framework]`.
const withStacks = ({ framework, ...a }) => (framework && !a.stacks ? { ...a, stacks: [framework] } : a);
const passed = withStacks(JSON.parse(process.argv[2] || "{}"));
// srcDirs merge per stack: an update that passes one stack's folders keeps the others'.
const answers = { modules: [], skipChecks: [], docsLanguage: "English", libraries: {}, ...withStacks(old), ...passed, srcDirs: { ...old.srcDirs, ...passed.srcDirs } };
// Modules renamed since the project's last run (`renamed` in modules.json) go by their new names; a new name that
// applies to none of the chosen stacks is not installed (below), like any such module.
const catalog = readJson(join(root, "modules.json"));
answers.modules = renameModules(answers.modules, catalog.renamed);
const { version } = readJson(join(root, ".claude-plugin", "plugin.json"));
const stackIds = answers.stacks ?? [];
attempt(() => checkStacks(catalog, stackIds));
// package.json is needed only on a `js` stack.
const isJs = (stackId) => catalog.stacks[stackId].language === "js";
const hasJs = stackIds.some(isJs);
// Checked before anything is written, so a failed run leaves the folder as it was.
if (stackIds.some((id) => catalog.stacks[id].language === "python") && !existsSync("pyproject.toml"))
  fail("pyproject.toml is missing; run this in the project folder");
// The node stack may start without one (loose scripts next to Python): it gets a minimal one.
if (stackIds.includes("node") && !existsSync("package.json")) {
  writeJson("package.json", { name: basename(process.cwd()), private: true });
  console.log("harness: created package.json for the node stack");
}
if (hasJs && !existsSync("package.json")) fail("no package.json here; run this in the project folder");
const pkg = readJson("package.json", {});
// Each chosen stack's source folders: the answer, else the stack's own.
const srcDirs = Object.fromEntries(stackIds.map((id) => [id, answers.srcDirs[id] ?? catalog.stacks[id].srcDirs]));
// The dev server port the hooks and the end-to-end tests use: the one the `dev` script sets, else one from the
// folder name, so projects on one machine rarely share it (the `dev` script then gets it below). No `dev` script, or no
// `js` stack, no port.
const portIn = (script) => Number(script?.match(/(?:^|\s)(?:--port|-p)[\s=]*(\d+)/)?.[1]) || undefined;
const devPort = portIn(pkg.scripts?.dev);
const folderPort = () => 3000 + [...basename(process.cwd())].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 1000, 0);
const port = hasJs && pkg.scripts?.dev ? (devPort ?? folderPort()) : undefined;
const skip = new Set(answers.skipChecks);
const noInstall = Boolean(process.env.HARNESS_NO_INSTALL);
// The project's package manager: pnpm when it has a pnpm lockfile or says so in `packageManager`, else npm.
const pm = existsSync("pnpm-lock.yaml") || String(pkg.packageManager ?? "").startsWith("pnpm") ? "pnpm" : "npm";

function fail(message) {
  console.error(`harness: ${message}`);
  process.exit(1);
}
// A lib function's error is a harness failure.
function attempt(fn) {
  try {
    return fn();
  } catch (error) {
    fail(error.message);
  }
}

// Selected modules plus the required ones, and the `auto` ones whose `detect` matches (package.json or files),
// in catalog order, with exactly one linter per chosen stack that some linter module applies to.
const detected = (m) =>
  Object.entries(m.detect ?? {}).some(([field, names]) => names.some((name) => (field === "files" ? existsSync(name) : name in (pkg[field] ?? {}))));
const wanted = new Set(answers.modules);
for (const [id, m] of Object.entries(catalog.modules)) {
  if (m.required || (m.auto && detected(m))) wanted.add(id);
  else if (m.auto) wanted.delete(id);
}
for (const id of wanted) {
  const m = catalog.modules[id];
  if (!m) fail(`unknown module "${id}"`);
}
// Each module on the chosen stacks it applies to: its own fields with `by.<language>` and `by.<stack>` merged over them,
// for each of those stacks. A module that applies to none of them is not installed.
// What a module brings on a `js` stack and on a `python` one is kept apart too: scripts and dev dependencies.
const appliesTo = (m, stackId) => applies(m, stackId, catalog, existsSync, pkg);
const stacksOf = {};
const modules = [];
const perStack = [];
for (const [id, m] of Object.entries(catalog.modules)) {
  if (!wanted.has(id)) continue;
  stacksOf[id] = stackIds.filter((stackId) => appliesTo(m, stackId));
  // `{srcDirs}` in the module's own fields: the folders of the stacks it applies to.
  const dirs = Object.fromEntries(stacksOf[id].map((stackId) => [stackId, srcDirs[stackId]]));
  const results = stacksOf[id].map((stackId) => effective(m, stackId, catalog, dirs));
  results.forEach((result, i) => perStack.push([stacksOf[id][i], result]));
  if (stacksOf[id].length) modules.push([id, attempt(() => combine(results))]);
}
const onLanguage = (language) => perStack.filter(([stackId]) => catalog.stacks[stackId].language === language).map(([, result]) => result);
for (const stackId of stackIds) {
  const linters = Object.entries(catalog.modules).filter(([, m]) => m.linter && appliesTo(m, stackId)).map(([id]) => id);
  if (linters.length && modules.filter(([id, m]) => m.linter && stacksOf[id].includes(stackId)).length !== 1)
    fail(`choose one linter for ${stackId} of ${linters.join(", ")} (default: ${catalog.stacks[stackId].linter})`);
}
const collect = (key) => modules.flatMap(([, m]) => m[key] ?? []);

// JSON the modules add to the project's own files: objects by key, arrays by item.
// `unmerge` takes back what the previous run added (a value the project changed since stays),
// so what no module needs any more goes. `merge` keeps a value the project set differently:
// it is listed in `kept` and dropped from `add`, so it stays the project's.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function merge(target, add, kept = [], at = "") {
  for (const [k, v] of Object.entries(add)) {
    if (Array.isArray(v)) target[k] = [...(target[k] ?? []), ...v.filter((x) => !(target[k] ?? []).some((y) => same(x, y)))];
    else if (isObject(v)) merge((target[k] ??= {}), v, kept, `${at}${k}.`);
    else if (k in target && !same(target[k], v)) {
      kept.push({ key: at + k, project: target[k], harness: v });
      delete add[k];
    } else target[k] = v;
  }
  return target;
}
// What this run adds again (`keep`) stays where it is, so an update does not reorder the file.
function unmerge(target, added, keep = {}) {
  for (const [k, v] of Object.entries(added)) {
    if (!(k in target)) continue;
    const kept = (x) => (keep[k] ?? []).some((y) => same(x, y));
    // An array still as the harness added it is replaced whole, so the new one keeps the harness order.
    if (Array.isArray(v) && same(target[k], v)) target[k] = structuredClone(keep[k] ?? []);
    else if (Array.isArray(v)) target[k] = target[k].filter((x) => !v.some((y) => same(x, y)) || kept(x));
    else if (isObject(v)) unmerge(target[k], v, keep[k] ?? {});
    else if (same(target[k], v) && !same(keep[k], v)) delete target[k];
    if (isObject(target[k]) || Array.isArray(target[k])) if (!Object.keys(target[k]).length) delete target[k];
  }
}

// Files: modules/<group>/<module>/all/, <language>/ and <stack>/ for each stack the module applies to, each written at
// the same path in the project; a later folder replaces the same path. Two stacks give one path only with the same text.
const files = {};
for (const [id, m] of modules) {
  const from = {};
  for (const stackId of stacksOf[id]) {
    const mine = {};
    for (const dir of ["all", catalog.stacks[stackId].language, stackId]) {
      const base = join(root, "modules", m.group, id, dir);
      if (!existsSync(base)) continue;
      for (const d of readdirSync(base, { recursive: true, withFileTypes: true })) {
        if (d.isFile() && d.name !== ".DS_Store") mine[relative(base, join(d.parentPath, d.name))] = join(d.parentPath, d.name);
      }
    }
    for (const [path, source] of Object.entries(mine)) {
      if (path in from && readFileSync(files[path], "utf8") !== readFileSync(source, "utf8")) fail(`${path} comes from both ${from[path]} and ${stackId}`);
      from[path] ??= stackId;
      files[path] = source;
    }
  }
}
// Two files have no source file: the libraries rule comes from the `libraries` answers, and the Dependabot config from the
// stacks (one file can name only package managers the project has, which per-language files cannot do for JS + Python).
if (wanted.has("libraries")) files[".claude/rules/libraries.md"] = null;
if (wanted.has("dependency-updates")) files[".github/dependabot.yml"] = null;
const installs = collect("install");
const paths = [...new Set([...Object.keys(files), ...installs.flatMap((i) => i.creates ?? [])])];

// What the previous run wrote, so what no module needs any more goes too.
// A harness.json from before `merged` lists the scripts, plugins and permissions it set instead.
const previous = {
  paths: [],
  mcp: [],
  merged: {
    "package.json": { scripts: Object.fromEntries((old.scripts ?? []).map((name) => [name, pkg.scripts?.[name]])) },
    ".claude/settings.json": { enabledPlugins: Object.fromEntries((old.plugins ?? []).map((p) => [p, true])), permissions: old.permissions ?? {} },
  },
  ...old,
};

// What the harness wrote last, by path: the base for the next merge, kept in .claude/harness.json.
// Before 0.28 it was a folder of copies, .claude/harness-base/; its files move in here.
const legacyBase = ".claude/harness-base";
const base = { ...old.base };
if (existsSync(legacyBase)) {
  for (const d of readdirSync(legacyBase, { recursive: true, withFileTypes: true })) {
    if (!d.isFile() || d.name.endsWith(".new")) continue;
    base[relative(legacyBase, join(d.parentPath, d.name))] ??= readFileSync(join(d.parentPath, d.name), "utf8");
  }
}
// The harness version of a file the skill merges by hand; the skill deletes the folder once merged.
const mergePath = (path) => join(".claude/harness-merge", path);

// Paths no module needs any more are removed, except a file the project has edited.
const edited = (path) => path in base && existsSync(path) && readFileSync(path, "utf8") !== base[path];
// A folder a removed file leaves empty goes too.
const prune = (dir) => {
  for (; dir !== "." && existsSync(dir) && !readdirSync(dir).length; dir = dirname(dir)) rmSync(dir, { recursive: true });
};
const notes = [];
const lock = readJson("skills-lock.json", null);
for (const path of previous.paths) {
  if (paths.includes(path)) continue;
  if (edited(path)) notes.push(`${path}: no module needs it any more, but the project edited it, so it stays`);
  else rmSync(path, { recursive: true, force: true });
  delete base[path];
  prune(dirname(path));
  if (lock?.skills && path.startsWith(".claude/skills/")) delete lock.skills[path.slice(".claude/skills/".length)];
}
if (lock) writeJson("skills-lock.json", lock);

// The libraries rule: its fixed text with one section per sections.json entry of the chosen stacks, from the `libraries` answers.
// The fixed text is libraries.md (libraries-node.md on node), or libraries-python.md when no `js` stack is chosen. With both,
// the Python sections follow the JS rule under libraries-python-after-js.md, and the rule's paths take Python files too.
// An answer is an option id, `none`, or a library the user named. A section with no answer yet gets its first option
// (`none` when it has none), or the one whose `firstWhen` matches an earlier section's answer.
function librariesRule() {
  const dir = join(root, "modules", catalog.modules.libraries.group, "libraries");
  const chosen = (section) => stackIds.some((id) => section.stacks.includes(id) || section.stacks.includes(catalog.stacks[id].language));
  const render = (section) => {
    if (!(section.id in answers.libraries)) {
      const matches = (o) => Object.entries(o.firstWhen ?? {}).some(([id, answer]) => answers.libraries[id] === answer);
      answers.libraries[section.id] = (section.options.find(matches) ?? section.options[0])?.id ?? "none";
      notes.push(`libraries: no answer for ${section.id}, so it uses ${answers.libraries[section.id]}`);
    }
    const answer = answers.libraries[section.id];
    const name = section.options.find((o) => o.id === answer)?.name ?? answer;
    const library = answer === "none" ? [] : ["", `**Library:** ${name}${section.use}`, ...(section.notes ? ["", ...section.notes.map((note) => `- ${note}`)] : [])];
    return [`## ${section.title}`, "", `**Platform:** ${section.platform}`, ...library, ""].join("\n");
  };
  const fill = (file, sections) => readFileSync(join(dir, file), "utf8").replace("<!-- sections -->\n", () => sections.map(render).join("\n") + "\n");
  const sections = readJson(join(dir, "sections.json")).sections.filter(chosen);
  if (!hasJs) return fill("libraries-python.md", sections);
  const python = sections.filter((section) => section.stacks.includes("python"));
  const js = fill(stackIds.includes("node") ? "libraries-node.md" : "libraries.md", sections.filter((section) => !python.includes(section)));
  if (!python.length) return js;
  return js.replace(/^(paths:\n(?: {2}- .*\n)*)/m, '$1  - "**/*.py"\n') + "\n" + fill("libraries-python-after-js.md", python);
}

// The Dependabot config: a weekly grouped pull request for GitHub Actions and for each package manager the stacks use.
// The `chore(deps)` commit messages pass commitlint.
function dependabotConfig() {
  const ecosystems = ["github-actions", ...(hasJs ? ["npm"] : []), ...(stackIds.some((id) => !isJs(id)) ? ["uv"] : [])];
  const update = (ecosystem) =>
    [
      `  - package-ecosystem: ${ecosystem}`,
      "    directory: /",
      "    schedule:",
      "      interval: weekly",
      "    commit-message:",
      "      prefix: chore",
      "      include: scope",
      "    groups:",
      `      ${ecosystem}:`,
      '        patterns: ["*"]',
    ].join("\n");
  return [
    "# Opens a weekly pull request with the new versions of this project's packages and GitHub Actions.",
    "version: 2",
    "updates:",
    ...ecosystems.map(update),
    "",
  ].join("\n");
}

// Each file keeps the project's edits: `base` holds what the harness wrote last,
// and the harness changes since then are merged into the project's version, as git merges branches.
const write = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
const tmp = mkdtempSync(join(tmpdir(), "harness-"));
// The same config under another extension (eslint.config.js for eslint.config.mjs, .prettierrc for .prettierrc.json):
// its tool reads only one. A script under another extension (a project's check-all.py next to check-all.sh) is another file.
const stem = (name) => (name.lastIndexOf(".") > 0 ? name.slice(0, name.lastIndexOf(".")) : name);
const configFormat = (name) => stem(name) === name || /\.(js|mjs|cjs|ts|mts|cts|json|jsonc|json5|yaml|yml|toml|ini)$/.test(name);
const sibling = (path) =>
  stem(basename(path)) !== basename(path) && configFormat(basename(path)) && existsSync(dirname(path))
    ? readdirSync(dirname(path)).find((f) => f !== basename(path) && stem(f) === stem(basename(path)) && configFormat(f))
    : undefined;
for (const [path, source] of Object.entries(files)) {
  const next = source ? readFileSync(source, "utf8") : path === ".github/dependabot.yml" ? dependabotConfig() : librariesRule();
  const other = sibling(path) && join(dirname(path), sibling(path));
  if (other && !existsSync(path)) {
    // The project has this file under another name: leave it for the skill to merge and rename.
    notes.push(`${path}: the project has it as ${other}; merge the harness version into it and rename it to ${path} (saved as ${mergePath(path)})`);
    write(mergePath(path), next);
    base[path] = next;
    continue;
  }
  if (other) notes.push(`${path}: ${other} is there too, and its tool reads only one; merge ${other} into ${path} and delete it`);
  if (existsSync(mergePath(path))) {
    // Still waiting for the skill to merge it by hand: refresh the harness version, keep the project's file.
    notes.push(`${path}: not merged yet; merge the harness version by hand (saved as ${mergePath(path)})`);
    write(mergePath(path), next);
    base[path] = next;
    continue;
  }
  const current = existsSync(path) ? readFileSync(path, "utf8") : next;
  if (current !== next && path in base) {
    if (current !== base[path]) {
      write(join(tmp, "base"), base[path]);
      write(join(tmp, "next"), next);
      try {
        execSync(`git merge-file -L project -L last-install -L harness "${path}" "${join(tmp, "base")}" "${join(tmp, "next")}"`, { stdio: "ignore" });
      } catch {
        notes.push(`${path}: merge conflicts; resolve the <<<<<<< markers`);
      }
      base[path] = next;
      continue;
    }
  } else if (current !== next && !previous.paths.includes(path)) {
    // The project had this file before the harness: leave it for the skill to merge.
    notes.push(`${path}: the project already had it; merge the harness version by hand (saved as ${mergePath(path)})`);
    write(mergePath(path), next);
    base[path] = next;
    continue;
  }
  write(path, next);
  base[path] = next;
}
rmSync(tmp, { recursive: true });

// Scripts: one a module brings on a `js` stack goes into package.json and runs through the package manager;
// the rest (on `python` only) run their `command` as written, its first word from `npx -y <npx>` when the script names one.
const scripts = Object.assign({}, ...modules.map(([, m]) => m.scripts));
const inPackage = new Set(onLanguage("js").flatMap((m) => Object.keys(m.scripts ?? {})));
const direct = (name) => (scripts[name].npx ? scripts[name].command.replace(/^\S+/, `npx -y ${scripts[name].npx}`) : scripts[name].command);
// package.json scripts, .claude/settings.json and .mcp.json servers: the modules' keys are set, the project's own are kept.
// A project with no package.json and no `js` stack gets none.
const merged = {
  ...((hasJs || existsSync("package.json")) && {
    "package.json": { scripts: Object.fromEntries(Object.entries(scripts).filter(([name]) => inPackage.has(name)).map(([name, s]) => [name, s.command])) },
  }),
  ".claude/settings.json": modules.reduce((settings, [, m]) => merge(settings, m.settings ?? {}), {}),
  ".mcp.json": { mcpServers: Object.assign({}, ...modules.map(([, m]) => m.mcpServers ?? {})) },
};
for (const [path, add] of Object.entries(merged)) {
  const json = readJson(path, {});
  unmerge(json, previous.merged[path] ?? {}, add);
  const kept = [];
  writeJson(path, merge(json, add, kept));
  for (const k of kept) notes.push(`${path}: the project's ${k.key} stays ${JSON.stringify(k.project)}; the harness one is ${JSON.stringify(k.harness)}`);
}

// The `dev` script serves on the port when it names none.
if (port && !devPort) {
  const json = readJson("package.json");
  json.scripts.dev += ` --port ${port}`;
  writeJson("package.json", json);
  notes.push(`package.json: the dev script now serves on port ${port}: ${json.scripts.dev}`);
}

// .mcp.json: a server an install added goes with its module too; with no servers left, the file goes.
const mcpNames = [...collect("mcp"), ...Object.keys(merged[".mcp.json"].mcpServers)];
const mcp = { mcpServers: {}, ...readJson(".mcp.json", {}) };
for (const name of previous.mcp) if (!mcpNames.includes(name)) delete mcp.mcpServers[name];
if (Object.keys(mcp.mcpServers).length) writeJson(".mcp.json", mcp);
else rmSync(".mcp.json", { force: true });

// .gitignore: the modules' lines go in one block under a harness comment. A line the project already has
// (with or without its leading or trailing slash) stays the project's; only the lines the harness added go with their module.
const gitignoreHeader = "# Added by the codebase-harness plugin";
const ignoreKey = (line) => line.trim().replace(/^\/|\/$/g, "");
const ignores = [...new Set(collect("gitignore"))];
const gitignoreText = existsSync(".gitignore") ? readFileSync(".gitignore", "utf8") : "";
const gone = (previous.gitignore ?? []).filter((line) => !ignores.includes(line));
const lines = (gitignoreText ? gitignoreText.replace(/\n$/, "").split("\n") : []).filter((line) => !gone.includes(line));
const stillAdded = (previous.gitignore ?? []).filter((line) => ignores.includes(line) && lines.includes(line));
const newIgnores = ignores.filter((line) => !lines.some((l) => ignoreKey(l) === ignoreKey(line)));
const ignoresAdded = [...stillAdded, ...newIgnores];
const legacyHeader = lines.indexOf("# Added by the frontend-harness plugin");
if (legacyHeader >= 0) lines[legacyHeader] = gitignoreHeader;
let header = lines.indexOf(gitignoreHeader);
if (newIgnores.length && header < 0) {
  if (lines.length && lines.at(-1).trim()) lines.push("");
  header = lines.push(gitignoreHeader) - 1;
}
if (newIgnores.length) {
  let end = header + 1;
  while (end < lines.length && stillAdded.includes(lines[end])) end++;
  lines.splice(end, 0, ...newIgnores);
} else if (!ignoresAdded.length && header >= 0) {
  // No harness line left: its comment goes too, with the blank line before it.
  const blank = Number(header > 0 && !lines[header - 1].trim());
  lines.splice(header - blank, 1 + blank);
}
if (lines.some((line) => line.trim())) {
  if (lines.join("\n") + "\n" !== gitignoreText) writeFileSync(".gitignore", lines.join("\n") + "\n");
} else if (gone.length) rmSync(".gitignore", { force: true });

// .claude/harness.json: what the hooks read, and what this run wrote.
// The hooks run `command` as written: a package.json script through the project's package manager, else the script's own command
// (a file check gets the file as its last argument).
const checks = collect("checks")
  .filter((c) => !skip.has(c.name))
  .map(({ name, script }) => ({ name, command: inPackage.has(script) ? `${pm} run -s ${script}` : direct(script) }));
const fileChecks = collect("fileChecks")
  .filter((c) => !skip.has(c.name))
  .map(({ name, script, extensions, blocking }) => ({ name, command: inPackage.has(script) ? `${pm} run -s ${script} --` : direct(script), extensions, blocking }));
// Reports are commands for audits; the hooks do not run them. The key is there only when a module brings one.
const reports = collect("reports");
writeJson(".claude/harness.json", {
  $comment: "Written by the codebase-harness plugin (tasks/apply.mjs). Do not edit; change the answers with /codebase-harness:setup.",
  version,
  stacks: stackIds,
  srcDirs,
  modules: modules.map(([id]) => id),
  skipChecks: [...skip],
  docsLanguage: answers.docsLanguage,
  libraries: answers.libraries,
  port,
  checks,
  fileChecks,
  ...(reports.length && { reports }),
  paths,
  merged,
  mcp: mcpNames,
  gitignore: ignoresAdded,
  base,
});
rmSync(legacyBase, { recursive: true, force: true });

// .claude/rules/harness.md: the always-loaded summary (a rule with no paths). Before 0.29 it was .claude/harness.md.
rmSync(".claude/harness.md", { force: true });
const md = [
  "# Harness",
  "",
  "Written by the codebase-harness plugin from `.claude/harness.json`; do not edit by hand.",
  "",
  ...(paths.includes("AGENTS.md") ? ["@../../AGENTS.md", ""] : []),
  `Harness modules: ${modules.map(([id]) => id).join(", ")}. Specs and plans are written in ${answers.docsLanguage}.`,
  "",
  "## Commands",
  "",
  "```bash",
  ...(port ? [`${pm} run dev`.padEnd(24) + `# http://localhost:${port}`] : []),
  ...Object.entries(scripts).map(([name, s]) => (inPackage.has(name) ? `${pm} run ${name}`.padEnd(24) : `${direct(name)}  `) + `# ${s.description}`),
  "```",
  "",
  ...(pm === "pnpm" ? ["The project uses pnpm: where a harness rule or skill says `npm run <script>` or `npx <tool>`, run `pnpm run <script>` or `pnpm exec <tool>`.", ""] : []),
].join("\n");
write(".claude/rules/harness.md", md);

// The harness hooks must be executable (the project's own files next to them keep their mode), and git must use
// .githooks/ (when a module brings git hooks) even before the next install; without them, git goes back to the
// project's own hooks. A project whose git hooks live elsewhere (husky) keeps them there.
for (const path of Object.keys(files)) {
  if (/^(\.claude\/hooks|\.githooks)\//.test(path) && existsSync(path)) chmodSync(path, 0o755);
}
try {
  const hooksPath = execSync("git config core.hooksPath || true", { encoding: "utf8" }).trim();
  if (!existsSync(".githooks")) {
    if (hooksPath === ".githooks") execSync("git config --unset core.hooksPath");
  } else if (!hooksPath || hooksPath === ".githooks") execSync("git config core.hooksPath .githooks", { stdio: "ignore" });
  else notes.push(`git runs its hooks from ${hooksPath}, so the harness git hooks in .githooks/ do not run; call them from there`);
} catch {
  // Not a git repo yet; the install runs `prepare` later.
}

// A tool reads its own file before pyproject.toml, so the settings the project has there stop counting.
if (stackIds.some((id) => catalog.stacks[id].language === "python")) {
  const pyproject = readFileSync("pyproject.toml", "utf8");
  const tables = [["ruff", "ruff.toml"], ["pytest.ini_options", "pytest.ini"], ["pyright", "pyrightconfig.json"], ["basedpyright", "pyrightconfig.json"], ["coverage", ".coveragerc"]];
  for (const [table, file] of tables)
    if (paths.includes(file) && new RegExp(`^\\[tool\\.${table.replace(".", "\\.")}[\\].]`, "m").test(pyproject))
      notes.push(`pyproject.toml has [tool.${table}]; ${file} now wins, so move its settings there`);
}

console.log(`harness ${version}: ${modules.map(([id]) => id).join(", ")} on ${stackIds.join(", ")}`);
for (const note of notes) console.log(`harness: ${note}`);

// Packages last, so every file above is written even when the install fails.
// Install only what the project does not have yet. A package may name its version (`size-limit@14.3.0`), for packages
// that must match each other.
const have = { ...pkg.dependencies, ...pkg.devDependencies };
const packageName = (p) => p.replace(/(?<=.)@.*$/, "");
const missing = [...new Set(onLanguage("js").flatMap((m) => m.devDependencies ?? []))].filter((p) => !(packageName(p) in have));
if (missing.length && !noInstall) {
  try {
    execSync(`${pm === "pnpm" ? "pnpm add --save-dev" : "npm install --save-dev"} ${missing.join(" ")}`, { stdio: "inherit" });
  } catch {
    fail(`${pm} install failed; install these by hand: ${missing.join(" ")}`);
  }
}
// Python dev dependencies go into pyproject.toml's dev group through uv.
if (stackIds.some((stackId) => catalog.stacks[stackId].language === "python") && !noInstall) {
  try {
    execSync("uv --version", { stdio: "ignore" });
  } catch {
    fail("uv is not installed; the python stack needs it: https://docs.astral.sh/uv/");
  }
  const pyproject = existsSync("pyproject.toml") ? readFileSync("pyproject.toml", "utf8") : "";
  const pyMissing = missingDevDeps(pyproject, [...new Set(onLanguage("python").flatMap((m) => m.devDependencies ?? []))]);
  if (pyMissing.length) {
    try {
      execSync(`uv add --dev ${pyMissing.join(" ")}`, { stdio: "inherit" });
    } catch {
      fail(`uv add failed; install these by hand: uv add --dev ${pyMissing.join(" ")}`);
    }
  }
}

// Install commands: each runs when a path it creates is missing (one that creates none, every time).
if (!noInstall) {
  for (const i of installs) {
    if (i.creates?.every((path) => existsSync(path))) continue;
    try {
      execSync(i.command, { stdio: "inherit" });
    } catch {
      fail(`install failed; run by hand: ${i.command}`);
    }
  }
}
