// lib/fs/fsync-batch.ts — the child process of fsyncAll in lib/fs.ts. Reads {paths} as JSON on stdin, fsyncs the
// paths concurrently on the libuv thread pool, and writes a JSON array to stdout: per path, null or the error.

import { close, fsync, open, readFileSync } from "node:fs";

const POOL_SIZE = Number(process.env.UV_THREADPOOL_SIZE) || 4;

type Failure = {code: string, message: string};
const failure = (e: NodeJS.ErrnoException): Failure => ({ code: e.code ?? "EIO", message: e.message });

const { paths } = JSON.parse(readFileSync(0, "utf8")) as {paths: string[]};

const one = (p: string) => new Promise<Failure | null>((resolve) => {
  open(p, "r", (e, fd) => {
    if (e) return resolve(failure(e));
    fsync(fd, (e2) => close(fd, () => resolve(e2 ? failure(e2) : null)));
  });
});

const out: (Failure | null)[] = [];
let next = 0;
const worker = async () => {
  while (next < paths.length) {
    const i = next++;
    out[i] = await one(paths[i]);
  }
};

Promise.all(Array.from({ length: POOL_SIZE }, worker)).then(() => process.stdout.write(JSON.stringify(out)));
