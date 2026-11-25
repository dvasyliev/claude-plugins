---
name: update
description: Use when the user asks to update the frontend harness: the plugin moved to codebase-harness, this tells how to migrate.
---

# frontend-harness is now codebase-harness

Tell the user this, then stop; do nothing else.

frontend-harness is now **codebase-harness**, in the marketplace **dvasyliev**. Run these, in order (`<scope>` is the scope the plugin is installed in: `user`, `project` or `local`):

1. `claude plugin uninstall frontend-harness@frontend-harness --scope <scope>`
2. `claude plugin marketplace remove frontend-harness`
3. `claude plugin marketplace add dvasyliev/claude-plugins`
4. `claude plugin install codebase-harness@dvasyliev --scope <scope>`
5. In `~/.claude/settings.json` and in the project's `.claude/settings.json`, replace the `enabledPlugins` key `frontend-harness@frontend-harness` with `codebase-harness@dvasyliev` (keep its `true` or `false` value).
6. `/reload-plugins`, then `/codebase-harness:update`.

The harness files already in the project stay and keep working.
