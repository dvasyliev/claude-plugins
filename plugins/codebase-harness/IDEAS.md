# Ideas

Changes worth making later. Not planned yet.

## GitLab

`ci` and `dependency-updates` write GitHub files only (`.github/workflows/ci.yml`, `.github/dependabot.yml`). For GitLab:

- A `host` answer in setup (GitHub or GitLab), taken from the `origin` URL; GitHub for projects that have none.
- The two modules get `github/` and `gitlab/` file folders, picked by `host` like `<stack>/` is picked by the stack.
- `ci` on GitLab: `.gitlab-ci.yml` with the same steps (packages, then `.claude/hooks/check-all.sh --force`).
- `dependency-updates` on GitLab: Renovate (`renovate.json`), which also runs on GitHub; Dependabot is GitHub only.
- Module names stay, so projects need no rename.

## Publishing packages

`releases` tags `vX.Y.Z` and stops there. A package still gets published by hand. Add a workflow that runs on the `v*` tag and publishes to npm or PyPI with trusted publishing (OIDC), so no token is stored in the repository. Offered with `releases`, by stack: npm for `js`, PyPI for `python`.

## Release button

`releases` releases on a push of the default branch, which suits work committed straight to it. With pull requests, offer a workflow with a `workflow_dispatch` button that runs the release script on the default branch and pushes the release commit and tag.

## Monorepos

`releases` keeps one version and one tag for the repository. A monorepo needs one tag per package (`<package>-vX.Y.Z`), each counting only the commits that touch its folder, as the repository's own `scripts/release.mjs` does.
