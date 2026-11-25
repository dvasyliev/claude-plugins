# Ideas

Changes worth making later. Not planned yet.

## GitLab

`ci` and `dependency-updates` write GitHub files only (`.github/workflows/ci.yml`, `.github/dependabot.yml`). For GitLab:

- A `host` answer in setup (GitHub or GitLab), taken from the `origin` URL; GitHub for projects that have none.
- The two modules get `github/` and `gitlab/` file folders, picked by `host` like `<stack>/` is picked by the stack.
- `ci` on GitLab: `.gitlab-ci.yml` with the same steps (packages, then `.claude/hooks/check-all.sh --force`).
- `dependency-updates` on GitLab: Renovate (`renovate.json`), which also runs on GitHub; Dependabot is GitHub only.
- Module names stay, so projects need no rename.
