# CONTRIBUTING.md and SECURITY.md

Written for this project, in English, from what the project has: read `package.json` (`scripts`, `packageManager`), the lock file, `pyproject.toml`, `.claude/harness.json` (`modules`) and the README before writing. Short and plain: a contributor reads them once, before the first pull request. Say only what is true of this project; leave out a section that does not apply.

## CONTRIBUTING.md

1. **Set up.** What to install (Node and its version from `engines` or `.nvmrc`; `uv` for Python) and the commands, with the project's package manager: `pnpm install` with `pnpm-lock.yaml`, `npm install` with `package-lock.json`, `uv sync` with `uv.lock`. Say that the install turns on the git hooks, when the project's `prepare` script sets `core.hooksPath`; otherwise give the command (`git config core.hooksPath .githooks`).
2. **Run it.** The commands to start the app or run the tool, from the README or the `dev`/`start` scripts.
3. **Check.** Before a pull request, the `check` script must pass (`npm run check`, or `pnpm check`). Say what it runs in a line, from the script. With git hooks, they run it too; never skip them with `--no-verify`.
4. **Commits.** With `commitlint` (the module, or a `commitlint.config.*` file): Conventional Commits, checked on every commit; give the form (`feat: ...`, `fix: ...`, `feat!: ...` for a breaking change) and the types it allows. Without it: one change per commit, a message that says what and why.
5. **Pull requests.** One change per pull request, against `main`; the template asks what, why and how it was tested. Bigger changes: open an issue first.
6. **Releases.** With `releases`: versions come from the commits (`feat`: minor, `fix` and others: patch, a breaking change: major), with CHANGELOG.md and a `vX.Y.Z` tag; with `releaseOn: "push"` the maintainer's push to `main` releases, with `"manual"` the `release` script does; contributors never change the version or CHANGELOG.md by hand. Without it: say who releases and how, if the user knows; else leave the section out.
7. **Code of conduct.** With `CODE_OF_CONDUCT.md`: a line that links to it.

## SECURITY.md

1. **Reporting.** Do not open a public issue. Report through GitHub private vulnerability reporting: the "Report a vulnerability" button on the Security tab (`https://github.com/<owner>/<repo>/security/advisories/new`). Step 6 of the skill turns it on; if the user declines, give a private contact instead (ask for one), never a public one.
2. **What to include.** The version, how to reproduce, what an attacker can do.
3. **What happens next.** When the user will answer (ask; "within a week" when they have no answer) and that the fix is released before the report is made public.
4. **Supported versions.** From the tags (`git tag -l 'v*' --sort=-v:refname`): the newest minor version gets fixes, as a small table (`| Version | Supported |`, `1.4.x` yes, older no). With no tags: "only the latest commit on `main`". Ask the user if they support more.
