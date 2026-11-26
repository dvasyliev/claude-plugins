#!/usr/bin/env node
// Releases the project: raises the version from the Conventional Commits since the last vX.Y.Z tag
// (breaking: major, or minor below 1.0; feat: minor; anything else: patch), writes it to package.json
// (npm or pnpm) and pyproject.toml (uv), adds the commits to CHANGELOG.md, commits and tags.
// Usage: node .githooks/release.mjs   (run in the project root)
// Prints `released v<version>` or `nothing to release`; a stop prints `release: <reason>` to stderr,
// exits 1 and changes nothing.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const run = (cmd, ...args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
const git = (...args) => run("git", ...args);
const stop = (reason) => {
  console.error(`release: ${reason}`);
  process.exit(1);
};

// The current version of each stack. A package.json without a version is skipped when there is a pyproject.toml.
const pkg = existsSync("package.json") ? JSON.parse(readFileSync("package.json", "utf8")) : null;
const pyText = existsSync("pyproject.toml") ? readFileSync("pyproject.toml", "utf8") : null;
const table = pyText?.match(/^\[project\][ \t]*\n([\s\S]*?)(?=^\[|(?![\s\S]))/m);
const pyVersion = table?.[1].match(/^version\s*=\s*["']([^"']+)["']/m)?.[1];
if (table && !pyVersion) stop("pyproject.toml has no static [project] version (is it dynamic?)");
const npmVersion = pkg?.version;
if (!pkg && !table) stop("no package.json or pyproject.toml with a [project] table");
if (pyVersion && npmVersion && pyVersion !== npmVersion) {
  stop(`package.json is at ${npmVersion} but pyproject.toml is at ${pyVersion}; make them equal first`);
}
const useNpm = pkg && (npmVersion || !table);
const current = pyVersion ?? npmVersion ?? "0.0.0";

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
  writeFileSync("CHANGELOG.md", `# Changelog\n\n${section}\n${old}`);

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
console.log(`released v${next}`);
