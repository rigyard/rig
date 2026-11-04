// lib/state/diff.mjs — internal to state. A small line diff for E_ADOPT_MISMATCH and E_DRIFT output.

const MAX_LINES = 2000;

/** Unified-style diff of two byte arrays: "-" current, "+" desired, two lines of context. */
export function unifiedDiff(path, current, desired) {
  const a = current ? Buffer.from(current).toString("utf8").split("\n") : [];
  const b = Buffer.from(desired).toString("utf8").split("\n");
  const head = `--- ${path} (current)\n+++ ${path} (desired)\n`;
  if (a.length > MAX_LINES || b.length > MAX_LINES) return `${head}@@ ${a.length} lines -> ${b.length} lines (too long to diff) @@\n`;
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
  const rows = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) rows.push([" ", a[i++], j++]);
    else if (j < b.length && (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])) rows.push(["+", b[j++]]);
    else rows.push(["-", a[i++]]);
  }
  const keep = rows.map((r, k) => r[0] !== " " || rows.slice(Math.max(0, k - 2), k + 3).some((x) => x[0] !== " "));
  let out = head;
  let gap = false;
  for (const [k, r] of rows.entries()) {
    if (keep[k]) {
      if (gap) out += "@@\n";
      out += `${r[0]}${r[1]}\n`;
      gap = false;
    } else gap = true;
  }
  return out;
}
