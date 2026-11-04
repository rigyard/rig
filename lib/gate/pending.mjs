// cve and budget are registry rows without logic yet. Each returns one typed finding so no run looks clean.

const pending = (check) => () => [{
  severity: "info",
  pack: "*",
  path: ".",
  evidence: `not implemented: ${check} check`,
  idBytes: `not implemented ${check}`,
}];

export const runCve = pending("cve");
export const runBudget = pending("budget");
