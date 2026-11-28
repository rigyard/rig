export interface Member { id: number; name: string; branch: "north" | "south" }

const names = [
  "Zoe", "Émile", "Eve", "Anna", "Óscar", "Bruno", "Olga", "Ángel", "Chloé", "Chris", "Dana", "Íris",
];

export const members: Member[] = names.map((name, i) => ({
  id: i + 1,
  name,
  branch: i % 2 === 0 ? "north" : "south",
}));
