import type { Member } from "./data.ts";

/** Merges two lists that are each already in name order into one list in name order. */
export function mergeDirectories(a: Member[], b: Member[]): Member[] {
  const out: Member[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i]!.name <= b[j]!.name) out.push(a[i++]!);
    else out.push(b[j++]!);
  }
  return out.concat(a.slice(i), b.slice(j));
}
