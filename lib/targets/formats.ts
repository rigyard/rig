// lib/targets/formats.ts — internal to targets. Per-harness file formats, docs section 2.4 closed enums.
// Pure, text in and text out. Frontmatter edits are line-level: rig never parses or reserializes YAML as a whole.

const FENCE = (line) => line.replace(/\r$/, "") === "---";
const TOP_KEY = /^([A-Za-z0-9_-]+):(.*)$/;

/**
 * Split a leading "---" frontmatter block. Returns null when the text has none.
 */
export function splitFrontmatter(text: string): {lines: string[], body: string} | null {
  const lines = text.split("\n");
  if (!FENCE(lines[0])) return null;
  const end = lines.findIndex((l, i) => i > 0 && FENCE(l));
  if (end < 0) return null;
  return { lines: lines.slice(1, end), body: lines.slice(end + 1).join("\n") };
}

const joinFrontmatter = (lines, body) => ["---", ...lines, "---", ""].join("\n") + body;

/** Group frontmatter lines into top-level entries; indented and blank lines belong to the entry above. */
function entries(lines) {
  const out = [];
  for (const line of lines) {
    const m = line.match(TOP_KEY);
    if (m) out.push({ key: m[1], lines: [line] });
    else if (out.length) out[out.length - 1].lines.push(line);
    else out.push({ key: null, lines: [line] });
  }
  return out;
}

/**
 * Set one top-level frontmatter key to a scalar. Replaces the key's lines, or appends the key. Creates the block
 * when the text has none. The value is written as JSON, which is valid YAML for booleans, numbers and strings.
 */
export function setFrontmatterKey(text: string, key: string, value: unknown): string {
  const fm = splitFrontmatter(text) ?? { lines: [], body: text };
  const line = `${key}: ${JSON.stringify(value)}`;
  const groups = entries(fm.lines);
  const hit = groups.find((g) => g.key === key);
  if (hit) hit.lines = [line];
  else groups.push({ key, lines: [line] });
  return joinFrontmatter(groups.flatMap((g) => g.lines), fm.body);
}

/** Keep only the named top-level keys, in their source order. */
function keepKeys(text, keys) {
  const fm = splitFrontmatter(text);
  if (!fm) return { lines: [], body: text };
  return { lines: entries(fm.lines).filter((g) => keys.includes(g.key)).flatMap((g) => g.lines), body: fm.body };
}

/**
 * The scalar value of a top-level key: plain, single- or double-quoted, or a "|" / ">" block. Undefined when absent.
 */
export function frontmatterValue(text: string, key: string): string | undefined {
  const fm = splitFrontmatter(text);
  const hit = fm && entries(fm.lines).find((g) => g.key === key);
  if (!hit) return undefined;
  const first = hit.lines[0].slice(key.length + 1).trim();
  const rest = hit.lines.slice(1).map((l) => l.replace(/\r$/, ""));
  if (/^[|>][+-]?$/.test(first)) {
    const body = rest.map((l) => l.trim());
    while (body.length && body[body.length - 1] === "") body.pop();
    return first.startsWith("|") ? body.join("\n") : body.join(" ");
  }
  if (first.startsWith('"')) {
    try {
      return JSON.parse([first, ...rest.map((l) => l.trim())].join(" "));
    } catch {
      return first.slice(1, -1);
    }
  }
  if (first.startsWith("'")) return [first, ...rest.map((l) => l.trim())].join(" ").slice(1, -1).replaceAll("''", "'");
  return [first, ...rest.map((l) => l.trim()).filter(Boolean)].join(" ");
}

/** units.command.format "md-body": the body only, frontmatter dropped. */
export function mdBody(text) {
  return splitFrontmatter(text)?.body ?? text;
}

/** units.command.format "skill-hidden": a SKILL.md with a name and disable-model-invocation: true (decision 0016). */
export function skillHidden(text, name) {
  let out = text;
  if (frontmatterValue(out, "name") === undefined) {
    const fm = splitFrontmatter(out) ?? { lines: [], body: out };
    out = joinFrontmatter([`name: ${name}`, ...fm.lines], fm.body);
  }
  return setFrontmatterKey(out, "disable-model-invocation", true);
}

/** units.rule.format "mdc", and an `.mdc` instructions path: a Cursor rule that always applies. */
export function mdc(text) {
  if (frontmatterValue(text, "alwaysApply") !== undefined) return text;
  return setFrontmatterKey(text, "alwaysApply", true);
}

/** units.rule.format "antigravity-md": an Antigravity rule that always applies. */
export function alwaysOnRule(text: string): string {
  return setFrontmatterKey(text, "trigger", "always_on");
}

/**
 * units.agent.format "cursor-md" and "antigravity-md": name, description and body. Model keys are cells and belong to the models
 * surfaces (section 8), so they are not copied from the Claude-shaped source. A non-empty `note` opens the body, and the
 * source body follows it unchanged.
 */
export function cursorAgent(text, name, note = "") {
  const kept = keepKeys(text, ["name", "description"]);
  const lines = kept.lines.some((l) => l.startsWith("name:")) ? kept.lines : [`name: ${name}`, ...kept.lines];
  return joinFrontmatter(lines, note ? `${note}\n${kept.body}` : kept.body);
}

/** A TOML multi-line basic string. */
function tomlMultiline(s) {
  const esc = s
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return `"""\n${esc}"""`;
}

/**
 * units.agent.format "codex-toml": name, description and developer_instructions. The model and
 * model_reasoning_effort keys are cells (section 8) and are not rendered here. A non-empty `note` opens developer_instructions,
 * and the source body follows it unchanged.
 * JSON.stringify output is a valid TOML basic string: every JSON escape is a TOML escape.
 */
export function codexAgent(text, name, note = "") {
  const description = frontmatterValue(text, "description") ?? "";
  const lines = [
    `name = ${JSON.stringify(name)}`,
    `description = ${JSON.stringify(description)}`,
    `developer_instructions = ${tomlMultiline(note ? `${note}\n${mdBody(text)}` : mdBody(text))}`,
  ];
  return lines.join("\n") + "\n";
}

/**
 * Set a two-level key ("a.b") in a small YAML file, line-level. Absent file text: a new file. A present "a:" block
 * gains or replaces its "  b:" line; every other line keeps its bytes.
 */
export function setYamlKey(text: string | null, dotted: string, value: unknown): {text: string} | {error: string} {
  const parts = dotted.split(".");
  if (parts.length !== 2) return { error: `sidecar key "${dotted}" must have exactly two levels` };
  const [outer, inner] = parts;
  const leaf = `  ${inner}: ${JSON.stringify(value)}`;
  if (text === null || text === "") return { text: `${outer}:\n${leaf}\n` };
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.replace(/\r$/, "") === `${outer}:`);
  if (start < 0) {
    const sep = text.endsWith("\n") ? "" : "\n";
    return { text: `${text}${sep}${outer}:\n${leaf}\n` };
  }
  let end = start + 1;
  while (end < lines.length && (/^\s+\S/.test(lines[end]) || lines[end].trim() === "")) end++;
  const at = lines.slice(start + 1, end).findIndex((l) => new RegExp(`^\\s+${inner}:`).test(l));
  if (at >= 0) lines[start + 1 + at] = leaf;
  else lines.splice(start + 1, 0, leaf);
  return { text: lines.join("\n") };
}
