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
- Keep the installed stacks, their source folders, modules and answers. Do not ask about them again; ask only about stacks and modules that are new since the installed `version`, about the ones a renamed or removed module needs (setup's step 1; `apply.mjs` itself renames `knip` to `unused` and `jscpd` to `dupes` and adds `types` and `prettier`, so ask nothing about those), and about `libraries` sections with no answer yet (setup's step 2).
- Run setup's step 3 with only the answers that change (none, most of the time), then its merge steps and step 4.
- Tell the user the version it went from and to, and what changed in the project. If the plugin was updated, tell them to run `/reload-plugins` (or restart Claude Code) to get its new skills.
