// License detection from a LICENSE file or package metadata. Never executes anything. Unknown is NOASSERTION,
// which the license gate treats as missing.

const TEXT_RULES = [
  [/Apache License,?\s+Version 2\.0/i, "Apache-2.0"],
  [/Mozilla Public License,?\s+(Version|v\.?)\s*2\.0/i, "MPL-2.0"],
  [/CC0 1\.0 Universal/i, "CC0-1.0"],
  [/This is free and unencumbered software released into the public domain/i, "Unlicense"],
  [/Permission to use, copy, modify, and\/or distribute this software for any purpose with or without fee/i, "ISC"],
  [/Redistribution and use in source and binary forms[\s\S]*Neither the name/i, "BSD-3-Clause"],
  [/Redistribution and use in source and binary forms/i, "BSD-2-Clause"],
  [/Permission is hereby granted, free of charge, to any person obtaining a copy/i, "MIT"],
];

export const NO_LICENSE = "NOASSERTION";

export function licenseFromText(text: string): string | null {
  for (const [re, id] of TEXT_RULES) if (re.test(text)) return id;
  return null;
}

/** @param json package.json bytes as text */
export function licenseFromPackageJson(json: string): string | null {
  try {
    const v = JSON.parse(json)?.license;
    const id = typeof v === "string" ? v : typeof v?.type === "string" ? v.type : null;
    return id && id.trim() !== "" ? id.trim() : null;
  } catch {
    return null;
  }
}

const CODE_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|mts|cts|py|rb|go|rs|java|c|h)$/i;
const NOTICE_NAME = /^(LICEN[SC]E|COPYING)([.\-_].*)?$/i;

export function isLicenseFile(path: string): boolean {
  const parts = path.split("/");
  if (parts.slice(0, -1).some((d) => d.toUpperCase() === "LICENSES")) return true;
  const name = parts[parts.length - 1];
  return NOTICE_NAME.test(name) && !CODE_EXT.test(name);
}

/** AND-join license ids so that no id can change the meaning of its neighbours. Unbalanced parentheses are unknown. */
export function joinLicenses(ids: string[]): string {
  const operands: string[] = [];
  for (const id of ids) {
    let depth = 0;
    for (const ch of id) {
      if (ch === "(") depth++;
      else if (ch === ")" && --depth < 0) return NO_LICENSE;
    }
    if (depth !== 0) return NO_LICENSE;
    operands.push(ids.length > 1 && /\s/.test(id) ? `(${id})` : id);
  }
  return operands.sort().join(" AND ");
}
