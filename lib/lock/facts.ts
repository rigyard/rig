// Parsed harness facts files (installed plugins, marketplaces), looked up through the target records.

/** @returns the parsed file declared as `facts[name]` by any target record */
export function fact(world, name): unknown | null {
  for (const target of world.targets?.values() ?? []) {
    const declared = target.facts?.[name];
    if (!declared) continue;
    const home = world.env?.home;
    for (const key of [declared, declared.replace(/^~\//, ""), home && declared.replace(/^~/, home)]) {
      if (key && world.facts?.has(key)) return world.facts.get(key);
    }
  }
  return null;
}
