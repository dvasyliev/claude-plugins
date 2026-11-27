# codebase-harness

How the plugin is built and how to change it. How to use it is in the plugin's `README.md`.

## Layout

```
.claude-plugin/plugin.json                 name and version
skills/setup/                              /codebase-harness:setup: picks modules, runs apply.mjs, merges what it cannot
skills/update/                             /codebase-harness:update: the same, as an update
skills/libraries/                          /codebase-harness:libraries: chooses or changes the libraries at any time
skills/audit/                              /codebase-harness:audit: checks existing code against the modules' rules, asks what to fix, fixes it
skills/open-source/                        /codebase-harness:open-source: checks history and files for secrets, adds the public-repository files, sets up GitHub
references/questions.md                    how the skills ask questions (AskUserQuestion)
modules.json                               every stack and module
modules/<group>/<module>/all/              a module's files for every stack it applies to, at their paths in the project
modules/<group>/<module>/<language>/       its files for one language (js, python), after all/
modules/<group>/<module>/<stack>/          its files for one stack (react, nextjs, python, node), after <language>/
modules/shared/libraries/                  the libraries rule and its sections.json, written by apply.mjs from the answers
tasks/apply.mjs                            writes the chosen modules into the project in the current folder
```

## Entities

| Entity | What it is |
|---|---|
| Stack | `modules.json` `stacks`: `react`, `nextjs`, `python` or `node` (a project may have several), with its `language` (`js` or `python`), source folders, default linter, the stacks it `excludes` and how to detect it. Picks the `<stack>/` version of each file. |
| Group | `modules.json` `groups`: `shared`, `js`, `web`, `nextjs`, `node`, `python`, with the `stacks` its modules apply to (every stack when `null`). The folder a module's files are in, and one setup question. |
| Module | `modules.json` `modules`: one tool or thing a project gets, in a `group` and a `category` (the kind of check: `formatting`, `linting`, `types`, `code-health`, `testing`, ...; a group too big for one setup question splits between categories). Applies to its group's stacks, or to the stacks or languages in its own `stacks` when it has them. Brings files, `scripts` (package.json), `checks` / `fileChecks` (run by the hooks), `settings` (.claude/settings.json), `mcpServers` (.mcp.json), `gitignore` (lines for .gitignore), npm `devDependencies`, `install` commands with the paths each `creates` (and the `.mcp.json` servers it adds in `mcp`), and `audit`: the rule files and skill folders the audit skill checks code against. `by.<language or stack>` holds any of these fields for one language or stack, merged over the module's own (language first, then stack). |
| Renamed modules | `modules.json` `renamed`: an old module name to its new one, or to an array of them when it split (`types` to `tsc` and `basedpyright`). `apply.mjs` replaces the old names in the stored and the passed `modules`, following a chain to the end, and drops a new name that applies to none of the project's stacks; check names (`skipChecks`) do not change. No old name may also be a module. |
| How a module is chosen | `required` always; `auto` exactly when its `detect` matches (package.json or files); `linter` exactly one per stack; `recommended` suggested; the rest offered, one question per group. |
| Answers | `stacks`, `modules`, `skipChecks`, `docsLanguage`, `libraries`, `releaseOn` (`push` or `manual`, only while `releases` is installed): passed to `apply.mjs`, kept in `.claude/harness.json`. |

## What apply.mjs writes in a project

| Path | Purpose |
|---|---|
| module files | Merged with the project's edits (`git merge-file` against `base` in `.claude/harness.json`). A file the project already had, or has under another extension, is left for the skill to merge (its harness version in `.claude/harness-merge/`). |
| `package.json`, `.claude/settings.json`, `.mcp.json` | The modules' keys are merged in and taken back when their module goes; a value the project set differently stays. |
| `.gitignore` | The modules' `gitignore` lines, in one block under a harness comment (the file is created if missing). A line the project already has is not added again; only the lines the harness added go when their module goes. |
| `.claude/harness.json` | Answers, version, the checks the hooks run, what this run wrote, and `base`: the text of each file the harness wrote last, the base for the next merge. |
| `.claude/rules/harness.md` | Installed modules and commands; always loaded, as a rule with no `paths`. |
| `.claude/rules/libraries.md` | With the `libraries` module: `modules/shared/libraries/libraries.md` (`libraries-node.md` on `node`, `libraries-python.md` when no `js` stack is chosen; with both, the Python sections follow under `libraries-python-after-js.md` and `paths` adds `**/*.py`) with one section per `sections.json` entry of the chosen stacks, written from the `libraries` answers, and merged with the project's edits like a module file. |
| `.github/dependabot.yml` | With the `dependency-updates` module: a weekly grouped update for GitHub Actions, npm (a `js` stack) and uv (`python`), merged with the project's edits like a module file. |
| `core.hooksPath` | `.githooks` when a module brings git hooks, unless the project runs its hooks from elsewhere (husky). |

A module that goes takes its files (unless the project edited them), scripts, settings, MCP servers and `.gitignore` lines with it; npm packages stay.

## Conventions

- Plain files, no templating. A file whose text depends on the language or stack gets one version per language or stack (`<language>/`, `<stack>/`). The exceptions are what `apply.mjs` writes from the answers: the two rules, and `.github/dependabot.yml`, which names only the package managers of the chosen stacks.
- Several modules may bring the same file (`.githooks/pre-push` from `playwright` and `releases`) only with equal text; `apply.mjs` refuses otherwise. That file runs each executable `.githooks/pre-push.d/*`, one per module, then `.githooks/pre-push.local`.
- Modules stand alone: no file needs another module to be installed. A step that only applies with another module says so in plain text ("With `playwright`: ...").
- The project's own work wins: edited files are merged, not overwritten; a script, setting or hooks path the project set stays; the harness takes back only what it added.
- `modules.json` lists the modules in the order their checks run, cheap ones first, not by group; the groups' order is that of `groups`.
- Package manager: npm or pnpm, whichever the project has (`pnpm-lock.yaml` means pnpm). Scripts and hooks check for the lockfile and use `pnpm` / `pnpm exec`, else `npm` / `npx`. Prose may write `npm run <script>` or `npx <tool>`; `apply.mjs` adds a line to `.claude/rules/harness.md` that says what to run instead in a pnpm project. Where a step only needs "the script", say "the `check` script".
- Everything in the plugin is written in English.
- Everything added to the plugin (a rule, a skill step, a check, a file or module name) is written for any project, so every project can reuse it: no name of the project, feature, file, route, component or service where the need was found. Name things by their kind (a unit, a service client, a route) and give examples that would fit an app about something else.

## Changing the harness

- New module: an entry in `modules.json` with its `group` and `category`, placed where its checks should run, its files in `modules/<group>/<module>/`. A module whose rules or skills apply to the app's code lists them in `audit`. Another repo's skill installs with `npx -y skills@<version> add <owner/repo> --skill <name> -a claude-code --copy -y` (projects update it with `npx skills update`); a tool with its own setup (like `npx -y ctx7@<version> setup`) installs with that command, with what it writes in `creates`.
- New stack (Vue, Nuxt, Svelte, Angular): an entry in `modules.json` `stacks`, and a `<stack>/` version of each per-stack file next to the module's `all/`.
- How to ask questions is written twice, since project files cannot read the plugin's: `references/questions.md` for the plugin's skills and the "Questions" section of the `feature-workflow` rule for projects. Change both together.
- Renamed or split module: an entry in `renamed` (an array for a split), which `apply.mjs` applies. Removed module: a line in the skill's step 1 telling it what to put in its place for projects that still list it.
- Try it on a scratch project with a `package.json`:

  ```bash
  HARNESS_NO_INSTALL=1 node <plugin>/tasks/apply.mjs '{"stacks": ["react"], "modules": ["core", "tsc", "prettier", "oxlint"]}'
  ```

  `HARNESS_NO_INSTALL=1` skips packages and install commands.
- Release: on push, as the repository's `CLAUDE.md` says (version, `CHANGELOG.md` and tag come from the commits). Projects get it with `claude plugin update`, or right away with `HARNESS_TEMPLATE` set to this folder.
