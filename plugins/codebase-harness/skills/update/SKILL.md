---
name: update
description: Use when the user wants to update the codebase harness in this project to the plugin's current version.
---

# Update the harness

## Get the newest plugin

Skip this when `$HARNESS_TEMPLATE` is set or the plugin runs from a local checkout (`--plugin-dir`: this skill's base directory is not under `~/.claude/plugins/cache/`).

1. Run `claude plugin marketplace update dvasyliev`: the plugin updates only from the marketplace's local copy, which nothing else refreshes.
2. Find the one scope this project runs the plugin from, by where it is installed, not where it is enabled (a user install is often turned off in `~/.claude/settings.json` and on in the project's settings). Run `claude plugin list --json` and take the entries with `id` `codebase-harness@dvasyliev`: the one whose `projectPath` is this project's root folder (scope `local` or `project`), else the one with scope `user`. Run `claude plugin update codebase-harness@dvasyliev --scope <scope>` for that scope only: another scope serves other projects, whose harness files would then lag behind their plugin. When there is no such entry, skip this step; never install the plugin here.
3. If it updated, this session still runs the old version's skills. Take the new version's folder (`~/.claude/plugins/cache/dvasyliev/codebase-harness/<new version>/`) as the template, read its `skills/update/SKILL.md` and follow that from "Update the project files", not this file.

## Update the project files

Follow the `setup` skill (`../setup/SKILL.md`, next to this skill's folder) as an **update**:

- Stop if `.claude/harness.json` is missing: the project has no harness yet; offer `/codebase-harness:setup`.
- Keep the installed stacks, their source folders, modules and answers. Do not ask about them again; ask only about stacks and modules that are new since the installed `version` (a name that is a target in the catalog's `renamed` is not new: the user already answered for it under its old name), about the ones a renamed or removed module needs (setup's step 1; `apply.mjs` itself renames the old modules in the catalog's `renamed`, such as `types` to `tsc` and `basedpyright` or `jscpd` to `dupes`, keeps those that apply to the project's stacks, and adds the required ones, such as `file-size` on Python, so ask nothing about those), and about `libraries` sections with no answer yet (setup's step 2).
- Run setup's step 3 with only the answers that change (none, most of the time), then its merge steps and step 4.
- When the installed modules had `resilience` without `best-practices`, tell the user that the project now also gets its stacks' best-practice skills: `resilience` merged into the `*-practices` modules, which bring both.
- Find the audit areas that are new or changed, before running setup's step 3 (it rewrites `base`). Take each installed module's audit paths in the template (its `audit` plus the one in `by.<language or stack>` for the project's stacks). A path is **new** when `base` in `.claude/harness.json` has no entry for it (this covers every area of a module added in this update), and **changed** when the template's file differs from `base[path]`. `base` is keyed per file, so compare a skill folder file by file.
- Offer an audit of those areas. When any exist and git tracks source files in the stacks' `srcDirs`, ask with `AskUserQuestion`, as `../../references/questions.md` says, naming the areas: run `/codebase-harness:audit <modules>` now to check the existing code against them? One question, `multiSelect: false`, header "Audit", options "Audit now" (recommended; runs the audit skill with those modules) and "Later" (its description names the command with the modules, such as "run `/codebase-harness:audit <modules>` when you want it"). Ask it after the update's commit, as the last question.
- Tell the user the version it went from and to, and what changed in the project. If the plugin was updated, tell them to run `/reload-plugins` (or restart Claude Code) to get its new skills.
