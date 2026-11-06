// Preload for a child node process (NODE_OPTIONS=--import): at exit, append the count of fsync calls in the process
// to FSYNC_COUNT_FILE. Without FSYNC_COUNT_FILE it does nothing.

import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const file = process.env.FSYNC_COUNT_FILE;
if (file) {
  let n = 0;
  const { fsync, fsyncSync } = fs;
  Object.assign(fs, {
    fsync: (...a: Parameters<typeof fsync>) => (n++, fsync(...a)),
    fsyncSync: (fd: number) => (n++, fsyncSync(fd)),
  });
  syncBuiltinESMExports();
  process.on("exit", () => fs.appendFileSync(file, `${n}\n`));
}
