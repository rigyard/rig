import { listMembers } from "./directory.ts";
import { findByName } from "./lookup.ts";

console.log(listMembers().map((m) => m.name).join(", "));
console.log("Bruno is member", findByName("Bruno")?.id);
