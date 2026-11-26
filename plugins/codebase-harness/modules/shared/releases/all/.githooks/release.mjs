#!/usr/bin/env node
// Releases the project: raises the version from the Conventional Commits since the last vX.Y.Z tag
// (breaking: major, or minor below 1.0; feat: minor; anything else: patch), writes it to package.json
// (npm or pnpm) and pyproject.toml (uv), adds the commits to CHANGELOG.md, commits and tags.
// Usage: node .githooks/release.mjs   (run in the project root; `--hook` from the pre-push step, with the refs on stdin)
// Prints `released v<version>` (and turns on push.followTags) or `nothing to release`; a stop prints `release: <reason>` to stderr,
// exits 1 and changes nothing.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const run = (cmd, ...args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
const git = (...args) => run("git", ...args);
const stop = (reason) => {
  console.error(`release: ${reason}`);
  process.exit(1);
};

// Hook mode (.githooks/pre-push.d/releases): release only when the current branch is the default one and it is being
// pushed, and `releaseOn` in .claude/harness.json is not "manual". A release then stops the push, so the next push
// sends the release commit with the rest.
const hook = process.argv.includes("--hook");
if (hook) {
  const harness = existsSync(".claude/harness.json") ? JSON.parse(readFileSync(".claude/harness.json", "utf8")) : {};
  if ((harness.releaseOn ?? "push") !== "push") process.exit(0);
  let main = "main";
  try {
    main = git("symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD").replace(/^origin\//, "") || main;
  } catch {}
  let branch = "";
  try {
    branch = git("symbolic-ref", "--short", "-q", "HEAD");
  } catch {}
  if (branch !== main) process.exit(0);
  // One "<local ref> <local sha> <remote ref> <remote sha>" line per ref pushed. The local ref may be `HEAD`
  // (`git push origin HEAD`), so the line that counts sends this commit to the default branch.
  const head = git("rev-parse", "HEAD");
  const line = readFileSync(0, "utf8")
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .find(([, sha, remoteRef]) => remoteRef === `refs/heads/${main}` && sha === head);
  if (!line) process.exit(0);
  // A remote branch with commits this one lacks rejects the push; releasing first would leave the tag off the branch.
  const remoteSha = line[3];
  if (remoteSha && !/^0+$/.test(remoteSha)) {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", remoteSha, "HEAD"], { stdio: "ignore" });
    } catch {
      console.error(`release: origin/${main} has commits you do not have; pull first`);
      process.exit(0);
    }
  }
}

// The current version of each stack. A package.json without a version is skipped when there is a pyproject.toml.
const pkg = existsSync("package.json") ? JSON.parse(readFileSync("package.json", "utf8")) : null;
const pyText = existsSync("pyproject.toml") ? readFileSync("pyproject.toml", "utf8") : null;
const table = pyText?.match(/^\[project\][ \t]*\r?\n([\s\S]*?)(?=^\[|(?![\s\S]))/m);
const pyVersion = table?.[1].match(/^version\s*=\s*["']([^"']+)["']/m)?.[1];
if (table && !pyVersion) stop("pyproject.toml has no static [project] version (is it dynamic?)");
const npmVersion = pkg?.version;
if (!pkg && !table) stop("no package.json or pyproject.toml with a [project] table");
if (pyVersion && npmVersion && pyVersion !== npmVersion) {
  stop(`package.json is at ${npmVersion} but pyproject.toml is at ${pyVersion}; make them equal first`);
}
const useNpm = pkg && (npmVersion || !table);
const current = pyVersion ?? npmVersion ?? "0.0.0";
if (!/^\d+\.\d+\.\d+$/.test(current)) stop(`version ${current} is not X.Y.Z; set it to one first`);

// Commits since the last release tag (none: all of them), without the release commits themselves.
let tag = "";
try {
  tag = git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*.[0-9]*.[0-9]*");
} catch {}
const hashes = git("log", "--format=%h", tag ? `${tag}..HEAD` : "HEAD").split("\n").filter(Boolean);
const commits = hashes
  .map((hash) => {
    const subject = git("log", "-1", "--format=%s", hash);
    const breaking = /^[a-z]+(\([^)]*\))?!:/.test(subject) || /^BREAKING[ -]CHANGE:/m.test(git("log", "-1", "--format=%b", hash));
    return { hash, subject, breaking, type: subject.match(/^([a-z]+)/)?.[1], text: subject.replace(/^[a-z]+(\([^)]*\))?!?:\s*/, "") };
  })
  .filter((c) => !/^chore(\([^)]*\))?: release v\d/.test(c.subject));
if (!commits.length) {
  console.log("nothing to release");
  process.exit(0);
}

const [major, minor, patch] = current.split(".").map(Number);
const breaking = commits.some((c) => c.breaking);
const next =
  breaking && major > 0 ? `${major + 1}.0.0`
  : breaking || commits.some((c) => c.type === "feat") ? `${major}.${minor + 1}.0`
  : `${major}.${minor}.${patch + 1}`;
// A tag for the next version (left by a release that was undone, say) would make the tag step fail after the commit.
let tagged = true;
try {
  execFileSync("git", ["rev-parse", "-q", "--verify", `refs/tags/v${next}`], { stdio: "ignore" });
} catch {
  tagged = false;
}
if (tagged) stop(`tag v${next} already exists`);

// Stop before writing anything when the files the release touches have uncommitted changes.
const manager = existsSync("pnpm-lock.yaml") ? "pnpm" : "npm";
const touched = [...(useNpm ? ["package.json", manager === "pnpm" ? "pnpm-lock.yaml" : "package-lock.json"] : []), ...(table ? ["pyproject.toml", "uv.lock"] : []), "CHANGELOG.md"];
const changed = () => execFileSync("git", ["status", "--porcelain", "--", ...touched], { encoding: "utf8" }).split("\n").filter(Boolean).map((l) => l.slice(3));
const dirty = new Set(changed());
if (dirty.size) stop(`${[...dirty][0]} has uncommitted changes; commit or stash them first`);

// uv 0.7 or newer writes the Python version.
if (table) {
  let uv = "";
  try {
    uv = run("uv", "--version");
  } catch {}
  const [, uvMajor, uvMinor] = uv.match(/(\d+)\.(\d+)/) ?? [];
  if (!uv || Number(uvMajor) === 0 && Number(uvMinor) < 7) stop("uv 0.7 or newer is needed to write the Python version");
}

// Write the version with the stack's own tool, add the changelog, commit and tag.
let step = "";
try {
  if (useNpm) {
    step = `${manager} version`;
    run(manager, "version", next, "--no-git-tag-version", "--allow-same-version");
  }
  if (table) {
    step = "uv version";
    run("uv", "version", next);
  }

  // CHANGELOG.md: the new release on top.
  step = "CHANGELOG.md";
  const group = (title, list) => (list.length ? [`### ${title}`, "", ...list.map((c) => `- ${c.text} (${c.hash})`), ""] : []);
  const section = [
    `## ${next} (${new Date().toISOString().slice(0, 10)})`,
    "",
    ...group("Breaking", commits.filter((c) => c.breaking)),
    ...group("Features", commits.filter((c) => !c.breaking && c.type === "feat")),
    ...group("Fixes", commits.filter((c) => !c.breaking && c.type === "fix")),
    ...group("Other", commits.filter((c) => !c.breaking && c.type !== "feat" && c.type !== "fix")),
  ].join("\n");
  const old = existsSync("CHANGELOG.md") ? readFileSync("CHANGELOG.md", "utf8").replace(/^# Changelog\n\n/, "") : "";
  writeFileSync("CHANGELOG.md", `# Changelog\n\n${old ? `${section}\n${old}` : section}`);

  // Commit only the files this release changed (all were clean before), so nobody else's work comes along.
  step = "commit";
  const files = changed();
  git("add", "--", ...files);
  git("commit", "-m", `chore: release v${next}`, "--", ...files);
  step = "tag";
  git("tag", "-a", `v${next}`, "-m", `v${next}`);
} catch {
  stop(`${step} failed; the version files are changed but not committed`);
}
// So a plain `git push` sends the tag along with the release commit.
git("config", "--local", "push.followTags", "true");
if (hook) {
  console.error(`released v${next}; push again to send it`);
  process.exit(1);
}
console.log(`released v${next}; push.followTags is on, so git push sends the tag`);
