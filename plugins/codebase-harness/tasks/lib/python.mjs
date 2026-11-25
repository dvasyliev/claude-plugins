// Reads a project's pyproject.toml: which dev dependencies it already has. Plain text, no TOML parser.

// The strings in the `key = [...]` array of the `[table]` table (it may span lines; comments are skipped).
function strings(text, table, key) {
  const header = text.match(new RegExp(`^\\[${table.replaceAll(".", "\\.")}\\][ \\t]*(?:#.*)?$`, "m"));
  if (!header) return [];
  const body = text.slice(header.index + header[0].length);
  const start = body.match(new RegExp(`^[ \\t]*${key}[ \\t]*=[ \\t]*\\[`, "m"));
  const next = body.search(/^\[/m);
  if (!start || (next >= 0 && start.index > next)) return [];
  const out = [];
  const token = /"((?:[^"\\]|\\.)*)"|'([^']*)'|#[^\n]*|(\])/g;
  token.lastIndex = start.index + start[0].length;
  for (let m; (m = token.exec(body)) && !m[3]; ) if (m[1] !== undefined || m[2] !== undefined) out.push(m[1] ?? m[2]);
  return out;
}

// A requirement's package name, as pip compares them: before any version, extra, marker or URL; case and -/_ alike.
const name = (requirement) => requirement.trim().split(/[<>=!~[;@\s]/)[0].toLowerCase().replaceAll("_", "-");

// The names in `wanted` that neither `[dependency-groups] dev` nor `[tool.uv] dev-dependencies` lists.
export function missingDevDeps(pyprojectText, wanted) {
  const have = new Set([...strings(pyprojectText, "dependency-groups", "dev"), ...strings(pyprojectText, "tool.uv", "dev-dependencies")].map(name));
  return wanted.filter((w) => !have.has(name(w)));
}
