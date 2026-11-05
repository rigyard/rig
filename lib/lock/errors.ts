export class LockError extends Error {
  code: string;
  path?: string;
  constructor(code: string, message: string, path?: string) {
    super(message);
    this.name = "LockError";
    this.code = code;
    if (path !== undefined) this.path = path;
  }
}
