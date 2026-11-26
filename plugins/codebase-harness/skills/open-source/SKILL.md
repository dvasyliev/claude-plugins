---
name: open-source
description: Use when the user wants to make a project public (open source): check the git history and files for secrets and personal data, add a license, SECURITY.md, CONTRIBUTING.md and issue/PR templates, and set up GitHub for it.
---

# Make the project public

Going public happens once, and what is in the git history goes public with it. This skill checks the history and the current files for secrets and personal data, adds the files a public repository needs, and sets up GitHub. The files it adds belong to the project afterwards.

**Template:** `$HARNESS_TEMPLATE` if set, else this plugin's folder: two folders up from this skill's base directory. The issue and PR templates are in `<template>/skills/open-source/files/`, at their paths in the project.

**Questions:** ask as `../../references/questions.md` (from this skill's base directory) says.

## Hard rules

- A key or token that was ever committed is leaked. Say so first, before any other finding or fix: revoke it and make a new one wherever it was issued. Cleaning the history does not undo a leak.
- Never rewrite the history, start it over, force-push or change a GitHub setting without the user's explicit yes to that exact step. A yes to one step is not a yes to the next.
- Before any change to the history, make a backup with `git clone --mirror` (see `references/history-scan.md`) and say where it is.
- Never overwrite a file the project has; offer to add what it misses.
- Everything the skill writes is in English.

## 1. Look at the project

1. Run `git status --short`. If anything is uncommitted, stop and tell the user: the skill commits its changes, and the changes may be another agent's.
2. Visibility: `gh repo view --json visibility,owner,name`. Without `gh` or an `origin` remote, ask whether the repository is public, private, or not on GitHub yet.
3. Which of these exist: `LICENSE` (or `LICENSE.md`, `LICENSE.txt`), `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md` (also at the root or in `docs/`, where GitHub reads them too).
4. Whether `.claude/harness.json` exists, and its `modules`. Without it the skill still works; it only skips step 5.

## 2. History

Run the four checks in `references/history-scan.md`: keys and tokens with `gitleaks`, author and committer emails, emails, internal domains and IPs in the content, and large or unwanted files ever committed. Without `gitleaks` or docker, ask to install `gitleaks` (`brew install gitleaks`) or skip that check; never say the history is clean when it was skipped.

Report in chat, in the user's language, as that file says: what, where (commit, file), how bad. Leaked keys first, with the revoke step. With no findings, say so and go on.

Then ask how to fix the history, one question, only when there are findings the user wants out of it:

- **Keep the history** (the findings stay public; right when they are harmless, or the keys are revoked and nothing else matters).
- **Start over:** one commit with the current tree, in a fresh history. Loses every commit and tag; the skill tags the version from `package.json` or `pyproject.toml` on the new commit.
- **Rewrite:** `git filter-repo` removes the paths, replaces the strings and maps the emails. Keeps the history; every clone and fork breaks, open pull requests go stale.

Each choice that changes the history then needs its own yes for the backup-and-rewrite and, when the repository is on GitHub, another for the force push. Carry it out as `references/history-scan.md` says. A personal email the user keeps in new commits: show how to set the GitHub noreply address (`git config user.email <id>+<login>@users.noreply.github.com`).

## 3. Current files

1. Secrets in the files git tracks, with the same `secretlint` the `pre-commit` module runs: `git ls-files -z | xargs -0 npx -y -p secretlint@13.1.0 -p @secretlint/secretlint-rule-preset-recommend@13.1.0 secretlint`. It needs `.secretlintrc.json` (the `pre-commit` module brings it); without one, write `{"rules": [{"id": "@secretlint/secretlint-rule-preset-recommend"}]}` to a temporary file outside the project and add `--secretlintrc <that file>`. A tracked file is in the history, so a key found here is leaked: revoke it first, as above, then take it out of the file (read it from an environment variable instead).
2. `.env` files and other files the history check flagged that git still tracks: offer to `git rm --cached` them and add them to `.gitignore`.
3. Internal links and names: the same patterns as the history content check, over `git grep`. List them; the user decides what to change.
4. `README.md`: say what a stranger misses: what the project is, how to install and run it, the license. Offer to add the missing parts.

## 4. Missing files

List the missing ones and ask which to add (`multiSelect: true`, one option per file). For a file that exists, offer to add only what it misses.

- **`LICENSE`** (only when the project is going public; a project that stays private gets no license and no license question): ask which license: MIT (recommended), Apache-2.0; "Other" takes any SPDX id GitHub knows (`gh api /licenses --jq '.[].spdx_id'`). Get the official text with `gh api /licenses/<spdx id, lowercase> --jq .body` (without `gh`: `https://api.github.com/licenses/<id>`, field `body`). The owner defaults to the `origin` owner's name (`gh api /users/<owner> --jq '.name // .login'`); ask to confirm it. Fill in the placeholders: for MIT `[year]` (this year) and `[fullname]`; for Apache-2.0 `[yyyy]` and `[name of copyright owner]` in its appendix, the rest unchanged; for another license, the placeholders it has. Also set `license` to the SPDX id in `package.json` (`"license": "MIT"`) and in `pyproject.toml` (`license = "MIT"` under `[project]`), where the file exists.
- **`CODE_OF_CONDUCT.md`:** Contributor Covenant 2.1, offered only when the user gives a contact for reports (an email or a link). Fetch `https://raw.githubusercontent.com/EthicalSource/contributor_covenant/2.1/content/version/2/1/code_of_conduct.md`, drop the `+++` front matter at its top, and put the contact in place of `[INSERT CONTACT METHOD]`.
- **`CONTRIBUTING.md`** and **`SECURITY.md`:** written for this project, as `references/docs.md` says.
- **Issue and PR templates:** copy `.github/ISSUE_TEMPLATE/bug.yml`, `feature.yml`, `config.yml` and `.github/pull_request_template.md` from `<template>/skills/open-source/files/`. In `config.yml`, write the security link as the full URL of this repository (`https://github.com/<owner>/<repo>/security/advisories/new`). It works once private vulnerability reporting is on (step 6); if the user declines that, take the link out.

## 5. Modules

Only with `.claude/harness.json`. Without `ci` (checks on every pull request) or `releases` (a version, CHANGELOG and tag from the commits), offer to run `/codebase-harness:setup` with a request to add the missing ones, such as "add ci and releases". Run it after step 7's commit, since setup stops on uncommitted changes.

## 6. GitHub

Only for a repository on GitHub. Each setting is its own question; run its `gh` command only after a yes to it. Without `gh`, give the user the steps in the GitHub settings instead.

1. **Private vulnerability reporting** (security reports reach the maintainers, not a public issue): `gh api -X PUT repos/<owner>/<repo>/private-vulnerability-reporting`.
2. **Protect `main`** (no force push, no deletion): `gh api -X POST repos/<owner>/<repo>/rulesets --input -` with:

   ```json
   {
     "name": "main",
     "target": "branch",
     "enforcement": "active",
     "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
     "rules": [{ "type": "deletion" }, { "type": "non_fast_forward" }]
   }
   ```

   Pull requests and passing checks before a merge are a further choice: ask whether to add `{ "type": "pull_request", "parameters": { "required_approving_review_count": 0, "dismiss_stale_reviews_on_push": false, "require_code_owner_review": false, "require_last_push_approval": false, "required_review_thread_resolution": false } }` and, with `ci`, `{ "type": "required_status_checks", "parameters": { "strict_required_status_checks_policy": false, "required_status_checks": [{ "context": "check" }] } }` (`check` is the `ci` workflow's job). They block pushes straight to `main`, which a user without pull requests makes, and `releases` with `releaseOn: "push"` too; say so.

A history rewrite must be pushed before this ruleset, since it blocks force pushes.

Then list what is left to do by hand: the visibility switch itself (Settings, General, Danger Zone; or `gh repo edit --visibility public --accept-visibility-change-consequences`, only after a yes), the description and topics.

## 7. Commit

Commit the added and changed files in one commit, `docs: prepare the project to go public` (`chore:` when no doc was added). With `commitlint`, the message must pass it. Do not push; tell the user what is left: the steps above they skipped, revoking any leaked key, the force push if the history changed, and the visibility switch.
