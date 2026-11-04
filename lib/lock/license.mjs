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

/** @param {string} text @returns {string | null} */
export function licenseFromText(text) {
  for (const [re, id] of TEXT_RULES) if (re.test(text)) return id;
  return null;
}

/** @param {string} json package.json bytes as text @returns {string | null} */
export function licenseFromPackageJson(json) {
  try {
    const v = JSON.parse(json)?.license;
    const id = typeof v === "string" ? v : typeof v?.type === "string" ? v.type : null;
    return id && id.trim() !== "" ? id.trim() : null;
  } catch {
    return null;
  }
}

export const isLicenseFile = (name) => /^(LICEN[SC]E|COPYING)(\.[a-z]+)?$/i.test(name);
