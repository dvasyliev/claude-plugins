# Scanning the history

Four checks over every commit on every branch, a report, and the fixes. Run the checks from the project root. Write temporary files outside the project (`mktemp`), never into it.

## 1. Keys and tokens

`gitleaks` scans every commit (`git log -p --all`) with its own rules. First a file for the report:

```bash
report="$(mktemp)"
```

With `gitleaks` installed (`brew install gitleaks`):

```bash
gitleaks git --redact --no-banner --report-format json --report-path "$report"
```

With docker and no `gitleaks`:

```bash
docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:v8.30.1 git /repo --redact --no-banner --report-format json --report-path - > "$report"
```

Exit code 1 means it found something. Each entry in the report has `RuleID`, `Commit`, `File`, `StartLine`, `Author`, `Date` and the redacted `Match`; `--redact` keeps the secrets out of the chat. A finding in a test fixture or an example value can be harmless: open the file at that commit (`git show <commit>:<file>`) and say which it is. Keep the real secret out of the chat when you do.

## 2. Author and committer emails

```bash
git log --all --format='%an <%ae>%n%cn <%ce>' | sort -u
```

A personal or work address goes public with every commit. List each with the GitHub noreply address as the fix: `<id>+<login>@users.noreply.github.com` (`gh api /users/<login> --jq .id`). Addresses that are already noreply, or that the user wants public, are fine.

## 3. Emails, internal domains, IPs and home folders in the content

Every line ever added, with its commit and file:

```bash
re='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]+|(^|[^.0-9])(10|127)[.][0-9]+[.][0-9]+[.][0-9]+|192[.]168[.][0-9]+[.][0-9]+|172[.](1[6-9]|2[0-9]|3[01])[.][0-9]+[.][0-9]+|(^|[^.A-Za-z0-9-])[A-Za-z0-9-]+[.](internal|local|corp|lan|intranet)([^A-Za-z0-9-]|$)|/Users/[A-Za-z]|/home/[a-z]|[Cc]:\\\\Users'
git log -p --all --no-color --format='commit %h' \
  | awk -v re="$re" '/^commit /{c=$2} /^\+\+\+ b\//{f=substr($0,7)} /^\+/ && !/^\+\+\+ / && $0 ~ re {print c, f": "substr($0,2,160)}' \
  | sort -u -k2
```

Write dots as `[.]`: `awk -v` turns `\.` into any character. The pattern finds emails, private IPs (`10.*`, `127.*`, `192.168.*`, `172.16-31.*`), hosts on internal domains (`.internal`, `.local`, `.corp`, `.lan`, `.intranet`) and home folders (`/Users/<name>`, `/home/<name>`, `C:\Users`). Add the company's own domains and names when the user gives them. Leave out what is meant to be public: `example.com`, noreply addresses, the project's own public addresses, file names such as `.env.local`. It also finds lines that are still in the files today; those are fixed in the files (step 3 of the skill), and in the history only when the user wants them gone from it too.

## 4. Large and unwanted files

Every file ever committed, with its size:

```bash
objects="$(mktemp)"
git rev-list --objects --all \
  | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' \
  | awk '$1 == "blob"' > "$objects"
```

From that list (`awk '...' "$objects"`, `grep -E '...' "$objects"`):

- Over 1 MB: `awk '$3 > 1048576'`.
- Unwanted by name: `.env` files (not `.env.example`, `.env.sample`), database dumps and files (`.sql`, `.dump`, `.sqlite`, `.db`, `.bak`), archives (`.zip`, `.tar`, `.tgz`, `.gz`, `.7z`, `.rar`), keys and certificates (`.pem`, `.key`, `.p12`, `.pfx`, `id_rsa`): `grep -E '(^|/)\.env(\.[^/]*)?$|\.(sql|dump|sqlite3?|db|bak|zip|tar|tgz|gz|7z|rar|pem|key|p12|pfx)$|(^|/)id_(rsa|ed25519|ecdsa)$'`, then drop the example ones.

The commits of a path: `git log --all --format='%h %ad' --date=short -- <path>`. A `.env` or key file is read for secrets too (`git show <commit>:<path>`, without printing the values in the chat): every secret in it counts as leaked.

## Report

In chat, in the user's language, leaked keys first, then by how bad:

```markdown
## History: <n> findings

| # | What | Where | How bad |
|---|---|---|---|
| 1 | AWS access key (aws-access-token) | `a1b2c3d` `config/prod.env` | Leaked: revoke it first |
| 2 | Personal email `jane@...` as author | 214 commits | Personal data |
| 3 | `db.sql`, 48 MB | `d4e5f6a` | Large file, may hold data |
```

How bad, from worst: **leaked** (a key, token, password or private key: revoke and replace it wherever it was issued, before anything else), **personal data** (emails, names, home folders), **internal** (internal hosts, IPs, links), **size** (large files that only make clones slow). Group the same finding over many commits into one row. With no findings, say so in a line, and name any check that was skipped.

## Fixes

Each fix only after the user's explicit yes to it. First, every time:

1. **Revoke leaked keys.** Say it before anything else. A key that was pushed anywhere, even to a private repository, stays leaked after any rewrite: forks, clones, caches and CI logs keep it.
2. **Fetch every branch.** With an `origin` remote, a branch that is only on the remote is in neither the backup nor the clone the rewrite runs in (`git clone --no-local .` copies local branches only). Fetch, then make a local branch for each remote one that has none:

   ```bash
   git fetch origin --prune --tags
   git for-each-ref --format='%(refname:lstrip=3)' refs/remotes/origin | grep -vx HEAD | while read -r b; do
     git show-ref -q --verify "refs/heads/$b" || git branch "$b" "origin/$b"
   done
   ```

   The backup, the rewrite and `git push --all` then cover them too.
3. **Back up.** `git clone --mirror . "../$(basename "$PWD")-backup-$(date +%Y%m%d).git"`, and tell the user where it is. It keeps every branch and tag, so it holds the leaked data too: keep it private, delete it when the new history is pushed and checked.

### Start over

One commit with the current tree, in a fresh history. Every commit, branch and tag goes. Right for a small project whose history matters little. Run it in the project folder, in the skill's step 6 in place of its commit: by then step 3 has cleaned the files (secrets taken out, flagged files untracked with `git rm --cached`) and step 4 has added the new ones, so the new commit holds all of that and none of the secrets.

```bash
branch="$(git branch --show-current)"
git checkout --orphan fresh   # keeps the files and the index
git add -A                    # step 3 and 4 changes; the folder was clean before them
git commit -m "chore: first public version"
git branch -D "$branch" && git branch -m "$branch"
```

Then, each after a yes: delete the other local branches (`git branch -D <branch>`) and the tags (`git tag -d $(git tag -l)`), since they hold the old history. Tag the version from `package.json` (`version`) or `pyproject.toml` (`[project] version`) on the new commit: `git tag -a v<version> -m "v<version>"`; with no version, no tag. With `releases`, that tag is where the next release counts from.

The old commits stay in this folder until git drops them. Drop them only after the new history is pushed and checked, and only after a yes to this step, since it cannot be undone here (the backup still has them): `git reflog expire --expire=now --all && git gc --prune=now`.

### Rewrite

`git filter-repo` rewrites every commit and keeps the history. Install it with `brew install git-filter-repo`; without it, write `uvx git-filter-repo@2.47.0` wherever the commands below say `git filter-repo`. It refuses to run outside a fresh clone; run it in a fresh clone of the project (`git clone --no-local . ../<name>-rewrite`), check the result there, then push from that clone. In a fresh clone it turns the remote branches into local ones, so it rewrites every branch. Combine what the user chose in one run:

- Remove files from every commit: `git filter-repo --path <path> --path-glob '*.sql' --invert-paths`.
- Replace strings: a file with one rule per line (`<secret>==>REMOVED`, `regex:[a-z]+@corp[.]example==>user@example.com`), then `git filter-repo --replace-text <file>`. Keep the file outside the project and delete it after: it holds the secrets.
- Map emails: a mailmap file (`Jane Doe <123+jane@users.noreply.github.com> <jane@personal.example>`), then `git filter-repo --mailmap <file>`.

Check with the scans above that the findings are gone, and that the newest commit has the same files as before apart from the ones the rewrite changed: compare `git ls-tree -r <branch>` in the project and in the rewritten clone, and run the `check` script there (install the dependencies first). `git filter-repo` removes the `origin` remote: add the GitHub one back in the clone (`git remote add origin <url>`) before the push.

The project folder keeps the old history. From here on, the skill's steps 3 to 7 run in the rewritten clone, never in the project folder: a commit there would sit on the old history. A clone has no git hooks turned on, so turn them on there first, before steps 3 to 7: with the project's install when it sets `core.hooksPath` (`pnpm install`, `npm install`), else `git config core.hooksPath .githooks`. Tell the user to work from the rewritten clone (or a fresh clone of the new history once it is pushed), copy over the ignored files they need (such as `.env`), and delete the old folder when done.

### Push

Claude never runs these pushes: the project's guard blocks a force push, and it cannot be undone. Give the user the exact commands to run themselves, in a terminal or with `!` in front in Claude Code, only after a yes to the force push itself, and before step 7 protects the default branch (the ruleset blocks force pushes).

Before the commands, warn in plain words: this replaces the history on GitHub for good; every commit, branch and tag listed below is overwritten or deleted there; every clone and fork must clone again; open pull requests go stale; the only copy of the old history is the backup.

List the remote branches and tags first (`git ls-remote --heads --tags origin`): every one that holds the old history must be replaced or deleted, or the leaked data stays on GitHub. Name in the yes each remote branch the new history does not have. Never put a remote branch the backup lacks (`git --git-dir <backup> show-ref --verify refs/heads/<name>` fails) in the delete commands: its commits would be lost; fetch it and fix it first.

Every push gets `SKIP_RELEASE=1 SKIP_VERIFY=1` in front (`SKIP_RELEASE=1 SKIP_VERIFY=1 git push --force ...`). The remote still has the old commits, so the release step would stop with "pull first", and a pull brings the old history, leak included, back. The end-to-end tests are skipped too: the code is what was checked before the push.

- After a rewrite (run in the rewritten clone, `cd` to it first): `git push --force --all origin`, then `git push --force --tags origin`. Then delete the remote branches and tags the rewrite removed (`git push origin --delete <name>`, one per name).
- After starting over: `git push --force origin <branch>`, then `git push --force --tags origin`. Then delete every other remote branch and every remote tag the new history does not have (`git push origin --delete <name>`, one per name), each one named in the yes.

Write the commands out in full, with the real branch, tag and folder names, in one block the user can copy. When the user says they ran them, check with `git ls-remote --heads --tags origin` that the remote matches the new history (each sha equals the local one, no old branch or tag left) and say what still differs.

Say what breaks: every clone and fork must clone again; open pull requests go stale. GitHub keeps old commits reachable by their hash and in pull request refs for a while; for a leaked key that is one more reason to revoke it, and for personal data the user can push to a new repository instead or ask GitHub Support to purge the cached views.
