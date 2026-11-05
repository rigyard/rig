// The scope packs declared for one project, and whether Claude Code enables their rig-local plugin there.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expandHome } from "./read.ts";
import type { World } from "../world.ts";

const readJson = (abs) => {
  try {
    return JSON.parse(readFileSync(abs, "utf8"));
  } catch {
    return null;
  }
};

/** @param {string} p @param {string} home */
const normalize = (p, home) => resolve(expandHome(p, home)).replace(/\/+$/, "");

export function projectDeclaration(world: World, dir: string): {packs: {name: string, enabled: boolean, source: "local"|"project"|"user"|null}[]} {
  const home = world.env.home;
  const abs = normalize(dir, home);
  const settings = {
    local: readJson(join(abs, ".claude/settings.local.json"))?.enabledPlugins,
    project: readJson(join(abs, ".claude/settings.json"))?.enabledPlugins,
    user: readJson(join(home, ".claude/settings.json"))?.enabledPlugins,
  };

  // Precedence: local beats project beats user, key by key; the first source that mentions the id decides.
  const marketplace = world.targets.get("claude")?.channels?.plugin?.marketplace ?? null;
  const packs = [];
  for (const [name, entry] of Object.entries(world.config.packs)) {
    if (entry.scope !== "project" && entry.scope !== "hybrid") continue;
    if (!(entry.projects ?? []).some((p) => normalize(p, home) === abs)) continue;
    let enabled = false;
    let from = null;
    if (marketplace) {
      const pid = `${name}@${marketplace}`;
      for (const s of /** @type {const} */ (["local", "project", "user"])) {
        if (settings[s] && pid in settings[s]) {
          enabled = settings[s][pid] === true;
          from = s;
          break;
        }
      }
    }
    packs.push({ name, enabled, source: from });
  }

  return { packs };
}
