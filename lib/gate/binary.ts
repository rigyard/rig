// The one binary classifier. The text checks (unicode, secret, injection phrases) skip what it calls binary.
// exec does not use it: it reads bytes itself and keeps flagging executable magic.

const SNIFF = 8192;

/** Formats that carry bytes a text decoder turns into noise. A closed table. Executable formats are caught by their NUL bytes. */
const DATA_MAGIC: readonly (readonly number[])[] = [
  [0xff, 0xd8, 0xff], // JPEG
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], // PNG
  [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], // GIF87a
  [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // GIF89a
  [0x25, 0x50, 0x44, 0x46, 0x2d], // PDF
  [0x50, 0x4b, 0x03, 0x04], // ZIP
];

/**
 * A harness loads a file with one of these extensions as text, whatever its first bytes say, so a pack could
 * hide a hidden code point or a pipe-to-shell behind a NUL byte or an image header. These files are always scanned.
 */
const TEXT_EXT = new Set([
  "md", "mdc", "markdown", "txt", "json", "jsonc", "yml", "yaml", "toml",
  "sh", "bash", "zsh", "fish", "ksh", "csh", "py", "rb", "pl", "php", "lua", "js", "mjs", "cjs", "ts", "mts", "cts", "ps1", "bat", "cmd",
]);

const startsWith = (bytes: Uint8Array, magic: readonly number[]) => magic.every((b, i) => bytes[i] === b);

/** True when the text checks must skip the file: a known magic number or a NUL byte in the first 8 KiB, and no text extension. */
export function isBinary(path: string, bytes: Uint8Array): boolean {
  const base = path.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot > 0 && TEXT_EXT.has(base.slice(dot + 1).toLowerCase())) return false;
  if (DATA_MAGIC.some((m) => startsWith(bytes, m))) return true;
  return bytes.subarray(0, SNIFF).includes(0);
}
