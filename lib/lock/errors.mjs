export class LockError extends Error {
  /** @param {string} code @param {string} message @param {string} [path] */
  constructor(code, message, path) {
    super(message);
    this.name = "LockError";
    this.code = code;
    if (path !== undefined) this.path = path;
  }
}
