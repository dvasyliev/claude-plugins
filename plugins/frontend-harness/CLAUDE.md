# frontend-harness

How the plugin is built and how to change it. How to use it is in the repository's `README.md`.

## Layout

```
.claude-plugin/plugin.json                 name and version
skills/setup/                              /frontend-harness:setup: picks modules, runs apply.mjs, merges what it cannot
skills/update/                             /frontend-harness:update: the same, as an update
skills/libraries/                          /frontend-harness:libraries: chooses or changes the libraries at any time
skills/audit/                              /frontend-harness:audit: checks existing code against the modules' rules, asks what to fix, fixes it
references/questions.md                    how the skills ask questions (AskUserQuestion)
modules.json                               every stack and module
modules/<category>/<module>/all/           a module's files for every stack it applies to, at their paths in the project
modules/<category>/<module>/<language>/    its files for one language (js), after all/
modules/<category>/<module>/<stack>/       its files for one stack (react, nextjs), after <language>/
tasks/apply.mjs                            writes the chosen modules into the project in the current folder
```

## Entities

| Entity | What it is |
|---|---|
| Stack | `modules.json` `stacks`: `nextjs` or `react`, with its `language` (`js`), source folders, default linter, the stacks it `excludes` and how to detect it. Picks the `<stack>/` version of each file. |
| Module | `modules.json` `modules`: one thing a project gets, in a `category` (the kind of check: `formatting`, `linting`, `types`, `code-health`, `testing`, ...; also the folder its files are in). Applies to the stacks or languages in its `stacks` (every stack when absent). Brings files, `scripts` (package.json), `checks` / `fileChecks` (run by the hooks), `settings` (.claude/settings.json), `mcpServers` (.mcp.json), `gitignore` (lines for .gitignore), npm `devDependencies`, `install` commands with the paths each `creates` (and the `.mcp.json` servers it adds in `mcp`), and `audit`: the rule files and skill folders the audit skill checks code against. `by.<language or stack>` holds any of these fields for one language or stack, merged over the module's own (language first, then stack). |
| Renamed modules | `modules.json` `renamed`: old module name to new (`knip` to `unused`, `jscpd` to `dupes`). `apply.mjs` replaces the old names in the stored and the passed `modules`; check names (`skipChecks`) do not change. |
| How a module is chosen | `required` always; `auto` exactly when its `detect` matches (package.json or files); `linter` exactly one; `recommended` suggested; the rest offered, one question per category. |
| Answers | `stacks`, `modules`, `skipChecks`, `docsLanguage`, `libraries`: passed to `apply.mjs`, kept in `.claude/harness.json`. |

## What apply.mjs writes in a project

| Path | Purpose |
|---|---|
| module files | Merged with the project's edits (`git merge-file` against `base` in `.claude/harness.json`). A file the project already had, or has under another extension, is left for the skill to merge (its harness version in `.claude/harness-merge/`). |
| `package.json`, `.claude/settings.json`, `.mcp.json` | The modules' keys are merged in and taken back when their module goes; a value the project set differently stays. |
| `.gitignore` | The modules' `gitignore` lines, in one block under a harness comment (the file is created if missing). A line the project already has is not added again; only the lines the harness added go when their module goes. |
| `.claude/harness.json` | Answers, version, the checks the hooks run, what this run wrote, and `base`: the text of each file the harness wrote last, the base for the next merge. |
| `.claude/rules/harness.md` | Installed modules and commands; always loaded, as a rule with no `paths`. |
| `.claude/rules/libraries.md` | With the `libraries` module: `modules/best-practices/libraries/libraries.md` (`libraries-python.md` when no `js` stack is chosen; with both, the Python sections follow under `libraries-python-after-js.md` and `paths` adds `**/*.py`) with one section per `sections.json` entry of the chosen stacks, written from the `libraries` answers, and merged with the project's edits like a module file. |
| `core.hooksPath` | `.githooks` when a module brings git hooks, unless the project runs its hooks from elsewhere (husky). |

A module that goes takes its files (unless the project edited them), scripts, settings, MCP servers and `.gitignore` lines with it; npm packages stay.

## Conventions

- Plain files, no templating. A file whose text depends on the language or stack gets one version per language or stack (`<language>/`, `<stack>/`). The exceptions are the two rules `apply.mjs` writes from the answers.
- Modules stand alone: no file needs another module to be installed. A step that only applies with another module says so in plain text ("With `e2e`: ...").
- The project's own work wins: edited files are merged, not overwritten; a script, setting or hooks path the project set stays; the harness takes back only what it added.
- `modules.json` is ordered by category; checks run in module order, so cheap ones come first.
- Package manager: npm or pnpm, whichever the project has (`pnpm-lock.yaml` means pnpm). Scripts and hooks check for the lockfile and use `pnpm` / `pnpm exec`, else `npm` / `npx`. Prose may write `npm run <script>` or `npx <tool>`; `apply.mjs` adds a line to `.claude/rules/harness.md` that says what to run instead in a pnpm project. Where a step only needs "the script", say "the `check` script".
- Everything in the plugin is written in English.
- Files are written for any project: no file, route, component or service name from the project where a fix was found.

## Changing the harness

- New module: an entry in `modules.json` with its `category`, its files in `modules/<category>/<module>/`. A module whose rules or skills apply to the app's code lists them in `audit`. Another repo's skill installs with `npx -y skills@<version> add <owner/repo> --skill <name> -a claude-code --copy -y` (projects update it with `npx skills update`); a tool with its own setup (like `npx -y ctx7@<version> setup`) installs with that command, with what it writes in `creates`.
- New stack (Vue, Nuxt, Svelte, Angular): an entry in `modules.json` `stacks`, and a `<stack>/` version of each per-stack file next to the module's `all/`.
- How to ask questions is written twice, since project files cannot read the plugin's: `references/questions.md` for the plugin's skills and the "Questions" section of the `feature-workflow` rule for projects. Change both together.
- Renamed module: an entry in `renamed`, which `apply.mjs` applies. Removed module: a line in the skill's step 1 telling it what to put in its place for projects that still list it.
- Try it on a scratch project with a `package.json`:

  ```bash
  HARNESS_NO_INSTALL=1 node <plugin>/tasks/apply.mjs '{"stacks": ["react"], "modules": ["core", "types", "prettier", "oxlint"]}'
  ```

  `HARNESS_NO_INSTALL=1` skips packages and install commands.
- Release: on push, as the repository's `CLAUDE.md` says (version, `CHANGELOG.md` and tag come from the commits). Projects get it with `claude plugin update`, or right away with `HARNESS_TEMPLATE` set to this folder.
