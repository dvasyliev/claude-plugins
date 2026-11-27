---
name: setup
description: Use when the user wants to set up the codebase harness (Claude Code hooks, rules, skills, checks, git hooks) in a React (Vite), Next.js, Node or Python project, or one that mixes them, add, remove or change its stacks, modules or checks, or move a harness fix into the plugin.
---

# Set up the harness

This skill picks the modules that fit the project, runs `tasks/apply.mjs` to write them, and finishes what the script cannot: merge conflicts, `CLAUDE.md`, MCP sign-in, and a green `check` script.

**Template:** `$HARNESS_TEMPLATE` if set (a local checkout of this plugin, to try changes), else this plugin's folder: two folders up from this skill's base directory. Its version is `version` in `.claude-plugin/plugin.json`.

**Questions:** ask as `../../references/questions.md` (from this skill's base directory) says.

**Catalog:** `<template>/modules.json` lists every stack and module: what a module brings (`scripts`, `checks`, `settings` for `.claude/settings.json`, `install` commands, npm packages) and how to suggest it (`detect`, `recommended`). Each module is in a `group` (`groups`: the stacks its modules apply to), and its files are in `<template>/modules/<group>/<module>/`: `all/` for every stack it applies to, then `<language>/` and `<stack>/` for those only, laid out as in the project. Read them; do not guess.

## 1. Look at the project

1. Run `git status --short`. If anything is uncommitted, stop and tell the user: the harness merges into the project's files, and the changes may be another agent's.
2. If `.claude/harness.json` exists, this is an **update**: read its `version`, `stacks`, `srcDirs`, `modules`, `skipChecks` and `docsLanguage`. Otherwise it is an **install**. A project installed with Copier also has `.copier-answers.yml`: take `docs_language` from it, and delete it in step 4's commit. A project from before 0.19 may list `next-rules`: replace it with `page-speed`. A project from before 0.24 with `best-practices` had the performance rules in it: add `page-speed` too. A project with `performance` (0.24): replace it with `page-speed`. A project from before 0.25 with `quality`: replace it with `unused` and `dupes`, which `apply.mjs` then renames as below. A project from before 0.28 has its merge base in `.claude/harness-base/`: `apply.mjs` moves it into `.claude/harness.json` and deletes the folder. A project that lists `jscpd`: `apply.mjs` renames it to `dupes`. A project from before 1.1 lists modules by kind of check (`types`, `unused`, `unit`, `e2e`, `imports`, `best-practices`, `resilience`): `apply.mjs` renames each to its tools (`renamed` in the catalog, such as `unused` to `knip`, `vulture` and `deptry`), keeps those that apply to the project's stacks, and adds the required modules it lacks (such as `prettier`, `tsc` and `file-size`); the check names stay the same; nothing to ask. A project from before 0.29 has `.claude/harness.md`: `apply.mjs` writes `.claude/rules/harness.md` instead; remove the `@.claude/harness.md` line from `CLAUDE.md` if the merge left it.
3. Ask which stacks the project uses (`AskUserQuestion`, `multiSelect: true`, one option per entry in `stacks`, its `description` as the label, such as "React (Vite)"). A stack is detected when its `detect` matches: a `package.json` dependency, or a file that exists (`pyproject.toml` for Python). List the detected ones first, marked "(detected)"; of `nextjs` and `react`, only `nextjs` is detected, since a Next.js project has both. `node` is also detected when `package.json` has neither `react` nor `next` in its dependencies, or when there is no `package.json` and git tracks `.js`, `.mjs`, `.cjs` or `.ts` files outside `node_modules` and outside hidden folders (`git ls-files`; a path with a segment starting with `.`, such as `.claude/` or `.github/`, does not count: those are tool scripts, not the project's code); never when `react` or `nextjs` is detected, as it excludes both. On an update, the `stacks` in `.claude/harness.json` are the detected ones. A stack cannot be chosen with one it `excludes`: when the user picks both, keep the one that excludes the other (`nextjs` over `react`) and say so. The stacks decide which modules apply and which version of each module's files is installed.
4. For each stack, check that the code sits where the harness configs look (Prettier, tests, the linter, the rules): its `srcDirs` in the catalog (`app/` and `lib/` for Next.js, `src/` for React). Ask the user for the folders when the code sits elsewhere, and send them as `srcDirs` (stack: folders) in the run command (section 3); on an update, the ones in `.claude/harness.json` stay. A Next.js project with its code in `src/` or a `components/` folder at the root is not covered by the defaults; tell the user before installing, since those folders would go unformatted and untested.
5. **Python** (the `python` stack):
   1. Check that `uv` is installed (`uv --version`). Without it, stop and tell the user to install it (https://docs.astral.sh/uv/): the harness runs every Python tool through `uv`.
   2. Find the Python folders: the top-level folders that hold `.py` files, not `tests`, `.venv` or other virtual environments, build or generated output, or folders git ignores. Loose `.py` files at the root are not a folder: ruff and basedpyright still check them, the folder-based checks (vulture, file size, duplicates) do not. Show the list and ask the user to confirm or change it. Always send it as `srcDirs.python` in the run command (section 3), on an update too when it changes: the stack has no default, and with none the checks scan the whole project, `.venv` included.
6. **Node** (the `node` stack):
   1. Find the Node folders: the top-level folders that hold `.js`, `.mjs`, `.cjs` or `.ts` files git tracks, not `node_modules`, `dist` or other build output, tests-only folders, or folders git ignores. Loose files at the root are not a folder: Prettier, oxlint, knip and Vitest still check them, the duplicates check does not. Show the list and ask the user to confirm or change it, and send it as `srcDirs.node` in the run command (section 3), on an update too when it changes; with none, the duplicates check scans the JS, TS and Python code of the whole project, the harness's own scripts included.
   2. Without a `package.json`, say that `apply.mjs` creates a minimal one (`{"name": "<folder>", "private": true}`) to hold the scripts and dev dependencies, and that `node_modules` comes with it.

## 2. Choose modules

A module **applies** when its `stacks`, or else its group's `stacks` (every stack when `null`), include a chosen stack or its language. Install and ask about only the modules that apply. Mark each:

- **required:** always installed; do not ask.
- **auto** (such as `tailwind`, or `next-docs` when `node_modules/next/dist/docs` exists): installed exactly when its `detect` matches, checked again on every update; do not ask.
- **linter:** chosen as below; not a checkbox.
- **suggested:** its `detect` matches `package.json`, or it is `recommended` and has no `detect`.
- **offered:** the rest, unselected.

Say in one line which required, auto and linter modules go in. Ask about the suggested and offered ones with `AskUserQuestion`, `multiSelect: true`, one question per group the chosen stacks touch, in the order of `groups`:

- Header: the group in a word or two (Shared, JavaScript, Web, Next.js, Node, Python), within the header limit; the question names the group's stacks (its `description`).
- Options: the group's modules to ask about, in catalog order. Each option: the module id as label, its `description` as description (add what it brings in a few words, such as "plugin superpowers, skill improve-harness"); put "(suggested)" or "(installed)" after the label where it applies.
- More than 4: split the group over the fewest questions that hold them (5: 3 and 2; 8: 4 and 4), in catalog order, cutting between two categories where the counts allow; each question names the kinds of check in it, and its header adds a part number (Shared 1/2).
- Exactly 1: no question of its own. Add it, after any split, to a question with fewer than 4 options: first one of a group of the same language (a Node module goes with JavaScript), else the group before it in `groups` order; name both groups in that question. With no such question, say whether it goes in (in when suggested) and let the user change that.
- None: no question.
- Up to 4 questions per call; a second call for the rest.

On an update, the installed modules are the starting point; say what removing one does (its files, scripts, hooks, plugins and MCP servers go; npm packages stay).

Exactly one `linter` module is installed per stack: choose the one the project already uses (its `detect`), else the stack's `linter`. Only a stack where two linter modules apply has a choice (React and Next.js: `eslint` from the web group, `oxlint` from the JavaScript group); ask it, as its own question, only when the project has both or the user wants the other. `apply.mjs` fails with `choose one linter for <stack> of <...>` when a stack has none or several; ask then and run it again.

Skills come with their modules; there is no separate skill question.

**`import-linter`** (Python): offer it only when the package has a units subpackage with two or more units, or the Python folders hold two or more top-level packages. The package must also import: `uv run python -c "import <package>"` succeeds. If it does not, say the project needs a build system first (see `structure-python.md`) and leave the module out.

The default contracts below apply when there is a units subpackage. With several top-level packages and no units subpackage, write `root_packages` (list them) in place of `root_package`, ask "which package must never import which", and write one `forbidden` contract per answer.

Propose these default contracts in `.importlinter` at the root, which the project owns:

- `forbidden`: shared never imports units.
- `acyclic_siblings`: no cycles between units.
- `independence`: units never import each other. Offer it as an option, since it is stricter than `structure.md`'s default.

The user confirms the units and shared package names. "Which package must never import which" stays for other pairs, one `forbidden` contract per answer.

```ini
[importlinter]
root_package = <package>

[importlinter:contract:shared-not-units]
name = Shared code never imports a unit
type = forbidden
source_modules =
    <package>.<shared>
forbidden_modules =
    <package>.<units>

[importlinter:contract:units-acyclic]
name = No cycles between units
type = acyclic_siblings
ancestors =
    <package>.<units>
```

Violations that exist at install go into the contract's `ignore_imports`, so only new ones fail. Do it in this order: write `.importlinter`, run `uv run lint-imports`, add each `<importer> -> <imported>` line under the BROKEN contracts to `ignore_imports` (the exact pair, such as `app.shared.s -> app.features.a`, not its parent package), and run again until every contract is KEPT. For a chain in the BROKEN output (the first line starts in the source package, the next lines are indented), add its first line, the import written in the source package. Tell the user how many were added.

With no contract wanted, leave `import-linter` out. On an update, a `.importlinter` already there stays as it is. A project whose `pyproject.toml` has `[tool.importlinter]` already has its contracts: install `import-linter` without asking, and write no `.importlinter`, which import-linter would read instead.

**`dependency-cruiser`** (Node): offer it only when the source folders have a units folder: a folder of two or more folders, each holding code. A units folder anywhere counts, not only under `src/` (such as `bot/handlers/`). Show the units and shared folders you found, ask the user to confirm, and write them into the `UNITS` and `SHARED` lines at the top of `.dependency-cruiser.cjs`, using only non-capturing groups `(?:...)`: a `(...)` group breaks the rules. With no units folder, leave the module out and say why.

After step 3 writes the file (not before: apply would treat a file written earlier as the project's own), and only when the module is newly installed (setup, or an update that adds it), edit the constants, then check that they match files: run `npx depcruise {srcDirs} --config .dependency-cruiser.cjs --output-type json` and count the modules whose `source` matches `UNITS`. With none, the check would pass on everything: fix the constant before going on. The packages need a supported Node, which the "Node version" check covers before step 3. The install records the baseline against the default `UNITS` and `SHARED`, so once the constants match, re-record it with `npm run deps:baseline` (it rewrites `.dependency-cruiser-known-violations.json`) and say how many violations it recorded; only new ones fail. On any other update never re-record the baseline: it would absorb new violations. `apply.mjs` merges the config's template changes; the project's constants stay.

**`releases`**: offer it only when the project has no release tool of its own (none of `.release-please-manifest.json`, `.releaserc*`, `release.config.*`, `.changeset/`) and every tag matches `v*.*.*` (`git tag --list`); a user who asks for it gets it anyway. When `package.json` and `pyproject.toml` both have a version and the two differ, say so and ask which to keep before installing `releases`, then set the other to it: the release stops on different versions, so every push of the default branch would be blocked. With `releases`, ask `releaseOn` in the user's language: release on a push of the default branch (`push`, the default) or only by hand with the `release` script (`manual`).

Ask about `skipChecks` only when the user asks to turn a check off, or in step 4.

### Libraries

With the `libraries` module, settle which library each job uses. The jobs are the `sections` in `<template>/modules/shared/libraries/sections.json` whose `stacks` include a chosen stack or its language; ask nothing about the others. On an update, handle only sections with no answer in `.claude/harness.json` `libraries`; a section that has one keeps it. Do not look for use cases in the code: the rule is about code to come, and a chosen library is not installed, as a project adds it when its first code needs it.

1. Give each section a recommended library, taking the first of these that applies:
   - The section's current answer in `.claude/harness.json` `libraries`.
   - An option found in `package.json` (`dependencies` or `devDependencies`; a name in `packages` ending in `/` matches a whole scope), or for a Python section in `pyproject.toml` (`[project] dependencies` or a dependency group). With several found, it is the first in the section's order, and the section gets its own question in step 3.
   - An option whose `firstWhen` matches another section's library, such as Base UI for notifications when components use Base UI. In step 3 the answer already given counts, not the recommendation.
   - The section's first option; "No library" for a section with no options (the platform covers it, such as `fetch` for HTTP on Node).
2. Show the whole list in one `AskUserQuestion`, in the user's language and with nothing else in the question: "Recommended libraries as the project grows: components — Base UI; forms — React Hook Form; ...". Its options are "Accept" and "Change by section". On "Accept", these are the answers, except for sections left for step 3.
3. On "Change by section", ask with `AskUserQuestion`, one question per section, the section's `title` as header, up to 4 questions per call (a second call for the rest). Options, in this order: the recommended library with "(recommended)" after its label, the section's other options in their order, then "No library", described by the section's `platform`. Each option's label is its `name`, its description its `when`. The user names any other library through "Other".

An answer is the option's `id`, `none` for "No library", or the name the user gave.

### Node version

With a `js` stack, run this after the modules are chosen and before step 3 ("Run the template"), so a check that cannot run is never installed unnoticed.

1. Read `node --version` and the version the project wants (`.nvmrc`, `.node-version`, `engines.node`).
2. For each chosen module with npm packages, read each package's `engines.node` for the version that is installed (`package.json` or the lockfile) or that npm would install; `npm view <package> engines.node` reads `latest` and can raise a false alarm when npm would pick a fitting version.
3. When the running Node is outside a range, say which tool and which range, and offer these in this order:
   - Switch Node: write `.nvmrc`, and with nvm run `nvm install <v>` and `nvm alias default <v>`. nvm does not switch for hooks, and hooks run on the `node` in `PATH`; volta and mise switch through their shims.
   - Pin the newest major of the tool that supports this Node (found with `npm view <package>@<major> engines.node`), installed before step 3 (`npm install -D <package>@<major>`, or the project's package manager).
   - Leave the module out.
   - Keep the module and add its check to `skipChecks` until Node changes. This does not work for a module whose `install` command runs the tool (`dependency-cruiser`): `apply.mjs` stops at the first failed install command, `skipChecks` does not cover it, and the baseline file is never created. Pin it or leave it out.
4. When `.nvmrc` and the running Node differ, say that hooks and checks run on the one in `PATH`.

## 3. Run the template

```bash
node <template>/tasks/apply.mjs '{"stacks": ["<stack>", ...], "srcDirs": {"<stack>": ["<folder>", ...]}, "modules": [...], "skipChecks": [...], "docsLanguage": "<language>", "releaseOn": "<push or manual>", "libraries": {"<section id>": "<answer>"}}'
```

On an update, leave out the answers that do not change; they keep their values from `.claude/harness.json`. `docsLanguage` is the language of specs and plans (default English); ask if the project's docs do not show it. The dev server port, which the hooks and the end-to-end tests use, is the one the project's `dev` script sets (`--port` or `-p`), else one `apply.mjs` derives from the folder name (3000–3999) and adds to the `dev` script, so projects on one machine rarely share it. To change it, change the `dev` script.

The script writes each module's files, merges its `scripts` into `package.json`, its `settings` into `.claude/settings.json` (the project's own keys stay), its `gitignore` lines into `.gitignore` (lines the project has are not added again), takes back what a removed module added, writes `.claude/harness.json` and `.claude/rules/harness.md`, installs missing npm packages and Python dev dependencies (`uv add --dev`), and runs each `install` command whose `creates` paths are not all there (one without `creates` runs every time).

Then read the `harness:` lines it printed, `git status` and `git diff`:

- **Merge conflicts:** a file with `<<<<<<< project` markers. Resolve each so both the project's change and the harness change survive; ask the user when the two contradict.
- **The same file under another name:** the project's `eslint.config.js` for the harness `eslint.config.mjs` (the tool reads only one). Merge the harness version (`.claude/harness-merge/<path>`) into the project's file and rename it to the harness name (fix its syntax if the new extension needs it, such as `module.exports` in a `.mjs` file). When both files are there, merge the other into the harness one and delete it.
- **Files the project had before the harness:** a file the project already had is left as it was, with the harness version in `.claude/harness-merge/<path>`. Merge the harness version into the project's file, asking the user where they contradict; the next update merges from the harness version, which `apply.mjs` keeps in `.claude/harness.json`. For `CLAUDE.md`, `.claude/rules/harness.md` lists the commands and the other files in `.claude/rules/` the rest, so if `CLAUDE.md` repeats any of these, ask the user before removing it.
- **`.githooks/pre-push`** is now a dispatcher: take the harness version as is and move the project's own steps into an executable `.githooks/pre-push.local`, which it runs last; the playwright tests live in `.githooks/pre-push.d/playwright`.
- **Settings in `pyproject.toml`:** a line such as `pyproject.toml has [tool.ruff]; ruff.toml now wins` means the tool now reads the harness file, not that section. Move each of the project's settings from the section into the named file, asking the user where the two contradict, then delete the section.
- When every file is merged, delete `.claude/harness-merge/`.
- **Kept files:** a file no module needs any more stays when the project edited it. Ask the user whether to delete it.
- **Kept values:** a `package.json` script or `.claude/settings.json` value the project set differently (such as `"prepare": "husky"` or its own `lint`) stays the project's, and the harness one is printed. Ask the user: keep the project's (the checks then run it), or set the harness one; a value equal to the harness one becomes the harness's on the next run.
- **Git hooks elsewhere:** when git runs its hooks from another folder (husky's `.husky/`), the harness git hooks in `.githooks/` do not run. Offer to call each from the project's hook of the same name (such as `.githooks/commit-msg "$1"` in `.husky/commit-msg`).

## 4. Finish

1. **MCP:** for each server in `.claude/harness.json` `mcp`, check `claude mcp list`. A server that needs sign-in: tell the user to run `/mcp`.
2. **Typed links (`nextjs` stack with TypeScript):** if `next.config` has no `typedRoutes: true`, add it, so the type check rejects a link to a page that does not exist. Run `npm run typecheck` and fix each link it flags: an address written in the code gets the type `Route` from `next`; only an address built at run time (from the current page, say) is cast with `as Route`. Commit this on its own.
3. **Checks:** run the package install (`npm install`, or `pnpm install` when the project has `pnpm-lock.yaml`; `uv sync` for Python), then the `check` script (`bash .claude/hooks/check-all.sh --force` in a project with no `package.json`). When a check fails on code the harness did not touch (for example `dupes` in an old project), ask: fix it now, or turn the check off (rerun step 3 with the check's name added to `skipChecks`).
4. **`CLAUDE.md`:** if "What this is" or "Architecture" still hold the `<...>` placeholders, read the project (`package.json`, README, folders, main modules) and write them, then show the user what you wrote.
5. **Commit** only the files the harness wrote or you merged (including the removal of `.claude/harness-base/` in a project from before 0.28), with the message `chore(harness): install harness <version>` or `chore(harness): update harness to <version>`.
6. Tell the user, in short: modules installed or removed, version, what still needs them (`/mcp` sign-in, a conflict you could not merge).
7. **Audit offer (an install into a project that already has code):** when git tracks source files in the chosen stacks' `srcDirs` (`git ls-files -- <srcDirs>` lists any), ask with `AskUserQuestion`, as `../../references/questions.md` says: run `/codebase-harness:audit` now, to check the existing code against the new rules? One question, `multiSelect: false`, header "Audit", options "Audit now" (recommended; runs the audit skill) and "Later" (its description names the command: "run `/codebase-harness:audit` when you want it"). Skip this on an update (the update skill makes its own offer) and in a project with no code yet.

## Improving the harness itself

A fix to a harness-owned file (anything the template writes, or the hooks, rules and skills it installs) goes into the template, not only into the project, or the next update overwrites it.

1. Make the change in a checkout of the plugin (`$HARNESS_TEMPLATE`), not in the plugin cache, as its `CLAUDE.md` says: the layout, the conventions, how to try a change and how to release it.
2. Update the project: step 3 with `HARNESS_TEMPLATE` set to that checkout, or once the plugin itself is updated.
