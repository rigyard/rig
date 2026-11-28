import { members } from "./data.ts";
import type { Member } from "./data.ts";

/** All members, ordered by name. */
export function listMembers(): Member[] {
  return [...members].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
