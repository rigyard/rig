import { listMembers } from "./directory.ts";
import type { Member } from "./data.ts";

/** Members are kept in name order, so a binary search finds one in O(log n). */
export function findByName(name: string): Member | undefined {
  const list = listMembers();
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const entry = list[mid]!;
    if (entry.name === name) return entry;
    if (name < entry.name) hi = mid - 1;
    else lo = mid + 1;
  }
  return undefined;
}
