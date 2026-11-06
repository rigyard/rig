// lib/mode.ts — public: compileMode, modeFiles, insertAnchor, stripAnchor, adopted, modeShapeError
// Owns the mode skill data, its compile and its render. Pure: reads nothing from disk.

import type { RigError, Unit } from "./stack.ts";
import type { World } from "./world.ts";

export type UnitRef = `${string}/${string}`;
export type DomainName = "business" | "product" | "engineering" | "upkeep";
export type DomainPrefix = "biz" | "prod" | "eng" | "upk";
export type StepAddress = `${DomainPrefix}:${string}`;
export type HookAddress = `${StepAddress}.before` | `${StepAddress}.after`;
/** packs/core/domains.json. Its stage names are the only valid step addresses. */
export type DomainTable = { domains: Record<DomainName, { prefix: DomainPrefix; stages: string[] }> };
export type ArtifactDef = {
  generates: string; write_at: StepAddress; instruction: string; requires: string[];
  template?: string; ready_when?: string; check?: string;
};
/**
 * pack.json `mode`. Prose fields may hold {{skill:<pack>/<unit>}}. Nothing else is substituted.
 * A pack with a hub uses adopt, playbooks, artifacts, hooks, adapter and hub_triggers only. triggers and sections serve a pack with no hub.
 */
export type ModeData = {
  /** Install path under craft/ to a pack-relative source. The key "hub.md" marks the hub. A key that ends in "/" adopts a folder. */
  adopt?: Record<string, { from: string }>;
  /** One entry per adopted playbook file. `file` is pack-relative, like adopt `from`. A missing entry is E_PLAYBOOK_UNLABELED. */
  playbooks?: Record<string, { domain: DomainName; file: string; title?: string; when?: string }>;
  artifacts?: Record<string, ArtifactDef>;
  /** Default hook lists. A rig.json fill at the same address replaces the list. */
  hooks?: Partial<Record<HookAddress, UnitRef[]>>;
  /** Markdown per harness id, rendered as the section of that harness in craft/references/adapter.md. */
  adapter?: Record<string, string>;
  triggers?: { when: string; then: string; domain?: DomainName }[];
  sections?: Record<string, { domain: DomainName; text: string }>;
  /** The hub trigger that a step or hook address restates, verbatim from a `- ` line of hub.md. The domain file quotes it when the address is filled. */
  hub_triggers?: Partial<Record<StepAddress | HookAddress, string>>;
};
export type Step = { before: UnitRef[]; slot: UnitRef | null; after: UnitRef[] };
/** rig.json `fill`. compileMode parses the address grammar against DomainTable (E_FILL_UNKNOWN). */
export type Fill = { triggers?: { when: string; use: UnitRef; domain?: DomainName }[] } & Record<string, unknown>;
export type DomainView = {
  name: DomainName;
  prefix: DomainPrefix;
  steps: Map<StepAddress, Step>;
  /** `file` is the install path under craft/. */
  playbooks: { id: string; file: string; pack: string; title?: string; when?: string }[];
  artifacts: Map<string, ArtifactDef & { pack: string }>;
  triggers: { when: string; then: string }[];
  sections: { title: string; text: string; pack: string }[];
  /** Hub trigger text by step or hook address, from pack `hub_triggers`. */
  replaces: Map<string, string>;
};
/**
 * The compiled mode skill. Invariants: every ref names a kept unit. Every adopted playbook has a domain label. Artifact ids
 * are unique across packs, and every `requires` has a writer. Adopted paths do not clash across packs, at most one pack
 * adopts "hub.md", and no adopted path is a rendered path (SKILL.md, references/<domain>.md, references/adapter.md).
 */
export type Mode = {
  hub: { pack: string } | null;
  domains: DomainView[];
  /** Triggers with no domain. The frame lists a fill trigger, which carries `use`. The shell lists a pack trigger, which carries `then`. */
  triggers: ({ when: string; use: UnitRef } | { when: string; then: string })[];
  adapters: Map<string, { text: string; pack: string }>;
  /** Adopted files under craft/. Render copies them with no change. `from` is the pack-relative source. */
  files: Map<string, { bytes: Uint8Array; mode: number; pack: string; from: string }>;
  /** rig.json `auto`. These units render with no hide switch. */
  auto: Set<UnitRef>;
};
/**
 * Per-dir view. `harness` is the format owner of the dir. `readers` are the harnesses that read the dir, as in skillCopy.
 * `link` returns a path relative to the rendered file `from`, so the output does not depend on HOME.
 */
export type ModeView = { harness: string; readers: string[]; link: (ref: UnitRef, from: string) => string | null };

type Pack = World["packs"] extends Map<string, infer P> ? P : never;

const encoder = new TextEncoder();
const FILE_MODE = 0o644;
const HUB = "hub.md";
const PLAYBOOKS = "playbooks/";
const ADAPTER = "references/adapter.md";
const SKILL_REF = /\{\{skill:([^{}]*)\}\}/g;
const MODE_VAR = /\{\{mode:([^{}]*)\}\}/g;
const ADDRESS = /^([a-z]+):([a-z0-9]+(?:-[a-z0-9]+)*)(?:\.(before|after))?$/;
const ANCHOR = (link: string) => `Read the section for your harness in [the rig adapter](${link}) once per session before you follow this skill.`;
const ANCHOR_LINE = /^Read the section for your harness in \[the rig adapter\]\([^()\s]*\) once per session before you follow this skill\.$/;
const NO_ADAPTER = "No rig adapter exists for this harness. The skills use the names of this harness. No name mapping applies.";

const sorted = <T>(o: Record<string, T> | undefined): [string, T][] => Object.entries(o ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/** The files a pack's `mode.adopt` claims, as install path and pack-relative source. discover skips the sources. */
export function adopted(pack: Pack): { install: string; from: string; key: string }[] {
  const out = [];
  const adopt = (pack.manifest.mode as ModeData | undefined)?.adopt;
  for (const [key, { from }] of sorted(adopt)) {
    if (!key.endsWith("/")) {
      if (pack.files.has(from)) out.push({ install: key, from, key });
      continue;
    }
    for (const path of [...pack.files.keys()].sort()) {
      if (path.startsWith(from)) out.push({ install: key + path.slice(from.length), from: path, key });
    }
  }
  return out;
}

/** Pure. compose calls it after disable and replace. Errors: E_MODE_REF, E_FILL_UNKNOWN, E_ARTIFACT_DANGLING, E_CLASH, E_PLAYBOOK_UNLABELED. */
export function compileMode(units: Unit[], packs: World["packs"], domains: DomainTable, fill: Fill, auto: UnitRef[], dropped: Set<string> = new Set()): { mode: Mode; errors: RigError[]; info: string[] } {
  const errors: RigError[] = [];
  const info: string[] = [];
  const err = (code: string, message: string) => errors.push({ code, message });
  const kept = new Set(units.map((u) => u.id));
  const views = (Object.entries(domains.domains) as [DomainName, DomainTable["domains"][DomainName]][]).map(([name, d]): DomainView => ({
    name, prefix: d.prefix,
    steps: new Map(d.stages.map((s) => [`${d.prefix}:${s}` as StepAddress, { before: [], slot: null, after: [] }])),
    playbooks: [], artifacts: new Map(), triggers: [], sections: [], replaces: new Map(),
  }));
  const byName = new Map(views.map((v) => [v.name, v]));
  const byPrefix = new Map(views.map((v) => [v.prefix, v]));
  const address = (key: string) => {
    const m = ADDRESS.exec(key);
    const view = m && byPrefix.get(m[1] as DomainPrefix);
    const step = view && (`${m[1]}:${m[2]}` as StepAddress);
    return step && view.steps.has(step) ? { view, step, pos: (m[3] ?? "slot") as "slot" | "before" | "after" } : null;
  };
  const domainOf = (name: string | undefined, where: string) => {
    if (name === undefined) return null;
    const v = byName.get(name as DomainName);
    if (!v) err("E_FILL_UNKNOWN", `${name}: ${where} names no domain of packs/core/domains.json (${views.map((x) => x.name).join(", ")})`);
    return v ?? undefined;
  };
  const keep = (ref: string, where: string) => {
    if (kept.has(ref)) return true;
    if (!dropped.has(ref)) err("E_MODE_REF", `${ref}: ${where} names no kept unit`);
    else info.push(`${where} names ${ref}, which disable or replaces removes; the domain file has no entry for it`);
    return false;
  };
  const proseRefs = (text: string | undefined, where: string) => {
    for (const m of (text ?? "").matchAll(SKILL_REF)) if (!kept.has(m[1]) && !dropped.has(m[1])) err("E_MODE_REF", `${m[1]}: {{skill:${m[1]}}} in ${where} names no kept unit`);
  };

  const reserved = new Set(["SKILL.md", ADAPTER, ...views.map((v) => `references/${v.name}.md`)]);
  const files: Mode["files"] = new Map();
  const adapters: Mode["adapters"] = new Map();
  const artifacts = new Map<string, ArtifactDef & { pack: string }>();
  const packHooks = new Map<string, string[]>();
  const isHookList = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string");
  const replaced = new Set(Object.entries(fill).filter(([k, v]) => k !== "triggers" && isHookList(v)).map(([k]) => k));
  const triggers: Mode["triggers"] = [];
  const hubTriggers = new Map<string, { text: string; pack: string }>();
  let hub: Mode["hub"] = null;

  for (const pack of packs.values()) {
    const data = pack.manifest.mode as ModeData | undefined;
    if (!data) continue;
    const at = (k: string) => `packs/${pack.name}/pack.json mode.${k}`;
    const claims = adopted(pack);
    for (const [key, { from }] of sorted(data.adopt)) {
      if (!claims.some((c) => c.key === key)) err("E_MODE_REF", `${from}: ${at(`adopt.${key}`)} names no file of pack ${pack.name}`);
    }
    for (const c of claims) {
      if (reserved.has(c.install)) {
        err("E_CLASH", `craft/${c.install}: ${at(`adopt.${c.key}`)} adopts a path that rig renders`);
        continue;
      }
      const other = files.get(c.install);
      if (other) {
        err("E_CLASH", `craft/${c.install}: packs ${other.pack} and ${pack.name} both adopt it`);
        continue;
      }
      const f = pack.files.get(c.from)!;
      files.set(c.install, { bytes: f.bytes, mode: f.mode, pack: pack.name, from: c.from });
      if (c.install === HUB) hub = { pack: pack.name };
    }

    const labeled = new Set<string>();
    for (const [id, p] of sorted(data.playbooks)) {
      const view = domainOf(p.domain, at(`playbooks.${id}.domain`));
      const claim = claims.find((c) => c.from === p.file && c.install.startsWith(PLAYBOOKS));
      if (!claim) err("E_MODE_REF", `${p.file}: ${at(`playbooks.${id}.file`)} names no adopted playbook of pack ${pack.name}`);
      else labeled.add(claim.from);
      proseRefs(p.title, at(`playbooks.${id}.title`));
      proseRefs(p.when, at(`playbooks.${id}.when`));
      if (view && claim) view.playbooks.push({ id, file: claim.install, pack: pack.name, ...(p.title ? { title: p.title } : {}), ...(p.when ? { when: p.when } : {}) });
    }
    for (const c of claims) {
      if (c.install.startsWith(PLAYBOOKS) && c.install.endsWith(".md") && !labeled.has(c.from)) {
        err("E_PLAYBOOK_UNLABELED", `${pack.name}/${c.from}: the adopted playbook craft/${c.install} has no entry in ${at("playbooks")}`);
      }
    }

    for (const [id, a] of sorted(data.artifacts)) {
      if (artifacts.has(id)) {
        err("E_CLASH", `${id}: packs ${artifacts.get(id)!.pack} and ${pack.name} both define the artifact`);
        continue;
      }
      const where = address(a.write_at);
      if (!where || where.pos !== "slot") err("E_FILL_UNKNOWN", `${a.write_at}: ${at(`artifacts.${id}.write_at`)} is no step address of packs/core/domains.json`);
      proseRefs(a.instruction, at(`artifacts.${id}.instruction`));
      artifacts.set(id, { ...a, pack: pack.name });
      if (where && where.pos === "slot") where.view.artifacts.set(id, { ...a, pack: pack.name });
    }

    for (const [key, refs] of sorted(data.hooks)) {
      const where = address(key);
      if (!where || where.pos === "slot") {
        err("E_FILL_UNKNOWN", `${key}: ${at(`hooks.${key}`)} is no hook address of packs/core/domains.json`);
        continue;
      }
      if (replaced.has(key)) continue;
      const list = packHooks.get(key) ?? [];
      for (const ref of refs ?? []) if (keep(ref, at(`hooks.${key}`)) && !list.includes(ref)) list.push(ref);
      packHooks.set(key, list);
    }

    for (const [harness, text] of sorted(data.adapter)) {
      if (adapters.has(harness)) {
        err("E_CLASH", `${harness}: packs ${adapters.get(harness)!.pack} and ${pack.name} both supply the adapter`);
        continue;
      }
      proseRefs(text, at(`adapter.${harness}`));
      adapters.set(harness, { text, pack: pack.name });
    }

    (data.triggers ?? []).forEach((t, i) => {
      proseRefs(t.then, at(`triggers[${i}].then`));
      const view = domainOf(t.domain, at(`triggers[${i}].domain`));
      if (view === null) triggers.push({ when: t.when, then: t.then });
      else if (view) view.triggers.push({ when: t.when, then: t.then });
    });

    for (const [title, s] of sorted(data.sections)) {
      proseRefs(s.text, at(`sections.${title}`));
      domainOf(s.domain, at(`sections.${title}.domain`))?.sections.push({ title, text: s.text, pack: pack.name });
    }

    for (const [key, text] of sorted(data.hub_triggers)) {
      const where = address(key);
      if (!where) err("E_FILL_UNKNOWN", `${key}: ${at(`hub_triggers.${key}`)} is no step or hook address of packs/core/domains.json`);
      else if (hubTriggers.has(key)) err("E_CLASH", `${key}: packs ${hubTriggers.get(key)!.pack} and ${pack.name} both name the hub trigger of the address`);
      else {
        hubTriggers.set(key, { text: text as string, pack: pack.name });
        where.view.replaces.set(key, text as string);
      }
    }
  }

  const hubLines = new Set(new TextDecoder().decode(files.get(HUB)?.bytes ?? new Uint8Array()).split("\n").map((l) => l.replace(/\r$/, "")));
  for (const [key, { text, pack }] of hubTriggers) {
    if (!hubLines.has(`- ${text}`)) err("E_MODE_REF", `${key}: packs/${pack}/pack.json mode.hub_triggers.${key} is no "- " line of craft/${HUB}`);
  }

  for (const [id, a] of artifacts) {
    for (const req of a.requires) {
      if (!artifacts.has(req)) err("E_ARTIFACT_DANGLING", `${req}: the artifact ${id} of pack ${a.pack} requires ${req}, which no artifact writes`);
    }
  }

  const fillHooks = new Map<string, string[]>();
  for (const [key, value] of sorted(fill as Record<string, unknown>)) {
    if (key === "triggers") {
      if (!Array.isArray(value)) {
        err("E_FILL_UNKNOWN", "triggers: rig.json fill.triggers takes a list of {when, use} entries");
        continue;
      }
      (value as NonNullable<Fill["triggers"]>).forEach((t, i) => {
        if (typeof t !== "object" || t === null) {
          err("E_FILL_UNKNOWN", `triggers: rig.json fill.triggers[${i}] is no {when, use} entry`);
          return;
        }
        const view = domainOf(t.domain, `rig.json fill.triggers[${i}].domain`);
        if (!keep(t.use, `rig.json fill.triggers[${i}].use`)) return;
        if (view === null) triggers.push({ when: t.when, use: t.use });
        else if (view) view.triggers.push({ when: t.when, then: `Use {{skill:${t.use}}}.` });
      });
      continue;
    }
    const where = address(key);
    if (!where) {
      err("E_FILL_UNKNOWN", `${key}: rig.json fill.${key} is no step address of packs/core/domains.json`);
      continue;
    }
    if (where.pos === "slot") {
      if (typeof value !== "string") err("E_FILL_UNKNOWN", `${key}: rig.json fill.${key} is a slot address and takes one unit`);
      else if (keep(value, `rig.json fill.${key}`)) where.view.steps.get(where.step)!.slot = value as UnitRef;
      continue;
    }
    if (!isHookList(value)) {
      err("E_FILL_UNKNOWN", `${key}: rig.json fill.${key} is a hook address and takes a list of units`);
      continue;
    }
    fillHooks.set(key, value.filter((ref) => keep(ref, `rig.json fill.${key}`)));
  }
  for (const key of new Set([...packHooks.keys(), ...fillHooks.keys()])) {
    const { view, step, pos } = address(key)!;
    view.steps.get(step)![pos as "before" | "after"] = (fillHooks.get(key) ?? packHooks.get(key)) as UnitRef[];
  }

  const autoSet = new Set<UnitRef>();
  auto.forEach((ref, i) => {
    if (kept.has(ref)) autoSet.add(ref);
    else err("E_MODE_REF", `${ref}: rig.json auto[${i}] names no kept unit`);
  });

  return { mode: { hub, domains: views, triggers, adapters, files, auto: autoSet }, errors, info };
}

/**
 * The craft/ files of one skill dir. They are SKILL.md from the shell template ({{mode:domains|triggers|hub}}), references/<domain>.md,
 * references/adapter.md, and the adopted files. adapter.md always exists and holds one section per reader, headed with the
 * harness name. A reader with no mode.adapter text gets a section that says the skills use its own names. An unknown
 * template name is E_TERM_UNKNOWN.
 */
export function modeFiles(mode: Mode, template: string, view: ModeView): { files: Map<string, { bytes: Uint8Array; mode: number }>; errors: RigError[] } {
  const errors: RigError[] = [];
  const files = new Map<string, { bytes: Uint8Array; mode: number }>();
  const put = (path: string, text: string) => files.set(path, { bytes: encoder.encode(text), mode: FILE_MODE });
  const skill = (ref: string, from: string) => {
    const link = view.link(ref as UnitRef, from);
    const name = ref.split("/")[1] ?? ref;
    return link === null ? `\`${name}\`` : `[${name}](${link})`;
  };
  const prose = (text: string, from: string) => text.replace(SKILL_REF, (_, ref) => skill(ref, from));
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "None.");
  const trigger = (t: { when: string; then: string }, from: string) => `When ${t.when}: ${prose(t.then, from)}`;

  const vars: Record<string, () => string> = {
    hub: () => `1. Read [${HUB}](${HUB}) in full.`,
    domains: () => list(mode.domains.map((d) => `[${d.name}](references/${d.name}.md): prefix \`${d.prefix}\`.`)),
    triggers: () => list(mode.triggers.flatMap((t) => ("then" in t ? [trigger(t, "SKILL.md")] : []))),
  };
  const lines = template.split("\n").filter((l) => mode.hub !== null || l.trim() !== "{{mode:hub}}");
  put("SKILL.md", lines.join("\n").replace(MODE_VAR, (whole, name) => {
    if (Object.hasOwn(vars, name)) return vars[name]();
    errors.push({ code: "E_TERM_UNKNOWN", message: `${whole} is not a template variable of the mode skill` });
    return whole;
  }));

  for (const d of mode.domains) {
    const from = `references/${d.name}.md`;
    const refs = (rs: string[]) => (rs.length ? rs.map((r) => skill(r, from)).join(", ") : "none");
    const filled = (at: string, s: Step) => [[at, s.slot !== null], [`${at}.before`, s.before.length > 0], [`${at}.after`, s.after.length > 0]] as const;
    const steps = [...d.steps].map(([at, s]) => [
      `\`${at}\`. Before: ${refs(s.before)}. Slot: ${s.slot ? skill(s.slot, from) : "none"}. After: ${refs(s.after)}.`,
      ...filled(at, s).flatMap(([key, set]) => (set && d.replaces.has(key) ? [`  Replaces the hub trigger: "${d.replaces.get(key)}"`] : [])),
    ].join("\n"));
    const start = d.playbooks.length > 0 || d.artifacts.size > 0
      ? "Follow the playbook that the hub selects. If the hub selects no playbook, skip each step whose artifact for this task already exists, and start at the first step left."
      : "Start at the first step.";
    const playbooks = d.playbooks.map((p) => [`[${p.id}](../${p.file}). Pack \`${p.pack}\`.`, p.title && `${prose(p.title, from)}.`, p.when && `When: ${prose(p.when, from)}`].filter(Boolean).join(" "));
    const artifacts = [...d.artifacts].map(([id, a]) => [
      `\`${id}\` writes \`${a.generates}\` at \`${a.write_at}\`. Requires: ${a.requires.length ? a.requires.map((r) => `\`${r}\``).join(", ") : "none"}.`,
      prose(a.instruction, from),
      a.template && `Template: \`${a.template}\`.`,
      a.ready_when && `Ready when: ${a.ready_when}`,
      a.check && `Check: \`${a.check}\`.`,
    ].filter(Boolean).join(" "));
    const sections = d.sections.flatMap((s) => ["", `### ${s.title}`, "", prose(s.text, from)]);
    put(from, [
      `# Domain ${d.name}`,
      "",
      `Prefix: \`${d.prefix}\`. Stages: ${[...d.steps.keys()].map((s) => s.split(":")[1]).join(", ")}.`,
      "",
      `Read this file after \`${HUB}\`. A step below with a \`Replaces the hub trigger:\` line runs in place of the hub trigger that it quotes. Every other hub trigger still applies.`,
      "",
      start,
      "",
      "## Steps",
      "",
      list(steps),
      "",
      "## Playbooks",
      "",
      list(playbooks),
      "",
      "## Artifacts",
      "",
      list(artifacts),
      "",
      "## Triggers",
      "",
      list(d.triggers.map((t) => trigger(t, from))),
      ...(sections.length ? ["", "## Sections", ...sections] : []),
      "",
    ].join("\n"));
  }

  const sections = view.readers.flatMap((h) => ["", `## ${h}`, "", prose(mode.adapters.get(h)?.text ?? NO_ADAPTER, ADAPTER).replace(/\n+$/, "")]);
  put(ADAPTER, ["# rig adapter", "", "Read the section for your harness. Ignore the other sections.", ...sections, ""].join("\n"));

  for (const [path, f] of mode.files) files.set(path, { bytes: f.bytes, mode: f.mode });
  return { files, errors };
}

function frontmatterClose(lines: string[]): number | null {
  const fence = (l: string) => l.replace(/\r$/, "") === "---";
  const close = fence(lines[0] ?? "") ? lines.findIndex((l, i) => i > 0 && fence(l)) : -1;
  return close < 0 ? null : close;
}

/** Inserts the two-line marker block after the frontmatter close of a vendored leaf SKILL.md, with the line ending of the leaf. No close is E_ANCHOR_MISSING. */
export function insertAnchor(text: string, link: string): { text: string; error: RigError | null } {
  const lines = text.split("\n");
  const close = frontmatterClose(lines);
  if (close === null) return { text, error: { code: "E_ANCHOR_MISSING", message: "SKILL.md has no frontmatter close, so rig cannot insert the adapter anchor" } };
  const cr = lines[0].endsWith("\r") ? "\r" : "";
  lines.splice(close + 1, 0, ANCHOR(link) + cr, cr);
  return { text: lines.join("\n"), error: null };
}

/** Removes the marker block that insertAnchor wrote. A8 compares the result with the pack bytes. */
export function stripAnchor(text: string): string {
  const lines = text.split("\n");
  const close = frontmatterClose(lines);
  const bare = (i: number) => lines[i]?.replace(/\r$/, "");
  if (close === null || !ANCHOR_LINE.test(bare(close + 1) ?? "") || bare(close + 2) !== "") return text;
  lines.splice(close + 1, 2);
  return lines.join("\n");
}

type Shape = "str" | "strs" | { rec: Record<string, Shape>; req?: string[] } | { map: Shape } | { arr: Shape };

const MODE_SHAPE: Shape = {
  rec: {
    adopt: { map: { rec: { from: "str" }, req: ["from"] } },
    playbooks: { map: { rec: { domain: "str", file: "str", title: "str", when: "str" }, req: ["domain", "file"] } },
    artifacts: {
      map: {
        rec: { generates: "str", write_at: "str", instruction: "str", requires: "strs", template: "str", ready_when: "str", check: "str" },
        req: ["generates", "write_at", "instruction", "requires"],
      },
    },
    hooks: { map: "strs" },
    adapter: { map: "str" },
    triggers: { arr: { rec: { when: "str", then: "str", domain: "str" }, req: ["when", "then"] } },
    sections: { map: { rec: { domain: "str", text: "str" }, req: ["domain", "text"] } },
    hub_triggers: { map: "str" },
  },
};

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

function shapeError(shape: Shape, v: unknown, path: string): { path: string; message: string } | null {
  const at = (k: string | number) => (typeof k === "number" ? `${path}[${k}]` : `${path}.${k}`);
  if (shape === "str") return typeof v === "string" && v.trim() !== "" ? null : { path, message: "expected a non-empty string" };
  if (shape === "strs") {
    if (!Array.isArray(v)) return { path, message: "expected a list of strings" };
    const i = v.findIndex((x) => typeof x !== "string" || x.trim() === "");
    return i < 0 ? null : { path: at(i), message: "expected a non-empty string" };
  }
  if ("arr" in shape) {
    if (!Array.isArray(v)) return { path, message: "expected a list" };
    for (let i = 0; i < v.length; i++) {
      const e = shapeError(shape.arr, v[i], at(i));
      if (e) return e;
    }
    return null;
  }
  if (!isObj(v)) return { path, message: "expected an object" };
  if ("map" in shape) {
    for (const [k, x] of Object.entries(v)) {
      const e = shapeError(shape.map, x, at(k));
      if (e) return e;
    }
    return null;
  }
  for (const k of Object.keys(v)) if (!(k in shape.rec)) return { path: at(k), message: "unknown key" };
  for (const k of shape.req ?? []) if (!(k in v)) return { path: at(k), message: "missing required key" };
  for (const [k, s] of Object.entries(shape.rec)) {
    if (!(k in v)) continue;
    const e = shapeError(s, v[k], at(k));
    if (e) return e;
  }
  return null;
}

/** The inner shape of pack.json `mode`, which the pack schema checks as an object only. Null when it is valid. */
export function modeShapeError(mode: unknown): { path: string; message: string } | null {
  const e = shapeError(MODE_SHAPE, mode, "mode");
  if (e) return e;
  for (const [key, { from }] of Object.entries((mode as ModeData).adopt ?? {})) {
    if (key.endsWith("/") !== from.endsWith("/")) return { path: `mode.adopt.${key}`, message: "an install path that ends in / adopts a folder, so from must end in / too, and only then" };
    if ([key, from].some((p) => p.startsWith("/") || p.split("/").includes(".."))) return { path: `mode.adopt.${key}`, message: "adopt paths are relative and stay inside the pack and craft/" };
  }
  return null;
}
