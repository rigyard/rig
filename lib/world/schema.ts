// A small closed-key schema language. check() validates one value and returns its canonical form:
// record fields in spec order, map keys sorted (unless the map is `ordered`), arrays in their own order.

import { RigError, keyPath } from "./errors.ts";

export type Spec = {t: string, [k: string]: any};

export const S = {
  str: (o = {}) => ({ t: "str", ...o }),            // o.pattern: RegExp, o.nonEmpty: boolean, o.reject: (v) => string | null
  bool: () => ({ t: "bool" }),
  int: () => ({ t: "int" }),
  num: () => ({ t: "num" }),
  lit: (v) => ({ t: "lit", v }),
  enum: (vs) => ({ t: "enum", vs }),
  arr: (item, o = {}) => ({ t: "arr", item, ...o }), // o.union: overlay entries append; o.unique; o.nonEmpty
  rec: (fields, req = []) => ({ t: "rec", fields, req }),
  map: (val, o = {}) => ({ t: "map", val, ...o }),   // o.key: Spec for keys; o.ordered: keep insertion order
  nul: (spec) => ({ t: "nul", spec }),
  any: () => ({ t: "any" }),
  /** Discriminated union: the first variant whose key is present on the object. */
  one: (variants) => ({ t: "one", variants }),
  /** Custom node: f(value, fail, sub) returns the canonical value. sub(spec, value, ...keys) checks a child. */
  fn: (f) => ({ t: "fn", f }),
};

export const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const typeName = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

/**
 * @returns canonical value
 */
export function check(spec: Spec, value: unknown, file: string, path: (string|number)[] = []): any {
  const fail = (msg, at = path) => {
    throw new RigError("E_SCHEMA", msg, { file, path: keyPath(at) || "(root)" });
  };
  const sub = (s, v, ...keys) => check(s, v, file, [...path, ...keys]);
  switch (spec.t) {
    case "str":
      if (typeof value !== "string") fail(`expected a string, got ${typeName(value)}`);
      if (spec.nonEmpty && value.trim() === "") fail("must not be empty");
      if (spec.pattern && !spec.pattern.test(value)) fail(`${JSON.stringify(value)} does not match ${spec.pattern}`);
      if (spec.reject) {
        const why = spec.reject(value);
        if (why) fail(why);
      }
      return value;
    case "bool":
      if (typeof value !== "boolean") fail(`expected a boolean, got ${typeName(value)}`);
      return value;
    case "int":
      if (!Number.isInteger(value)) fail(`expected an integer, got ${typeName(value)}`);
      return value;
    case "num":
      if (typeof value !== "number" || !Number.isFinite(value)) fail(`expected a number, got ${typeName(value)}`);
      return value;
    case "lit":
      if (value !== spec.v) fail(`expected ${JSON.stringify(spec.v)}, got ${JSON.stringify(value)}`);
      return value;
    case "enum":
      if (!spec.vs.includes(value)) fail(`expected one of ${spec.vs.join(", ")}, got ${JSON.stringify(value)}`);
      return value;
    case "any":
      return value;
    case "nul":
      return value === null ? null : check(spec.spec, value, file, path);
    case "arr": {
      if (!Array.isArray(value)) fail(`expected an array, got ${typeName(value)}`);
      if (spec.nonEmpty && value.length === 0) fail("must not be empty");
      const out = value.map((v, i) => sub(spec.item, v, i));
      if (spec.unique) {
        const seen = new Set();
        out.forEach((v, i) => {
          const k = JSON.stringify(v);
          if (seen.has(k)) fail(`duplicate entry ${k}`, [...path, i]);
          seen.add(k);
        });
      }
      return out;
    }
    case "rec": {
      if (!isObj(value)) fail(`expected an object, got ${typeName(value)}`);
      for (const k of Object.keys(value)) if (!(k in spec.fields)) fail("unknown key", [...path, k]);
      for (const k of spec.req) if (!(k in value)) fail("missing required key", [...path, k]);
      const out = {};
      for (const k of Object.keys(spec.fields)) if (k in value) out[k] = sub(spec.fields[k], value[k], k);
      return out;
    }
    case "map": {
      if (!isObj(value)) fail(`expected an object, got ${typeName(value)}`);
      const keys = Object.keys(value);
      if (!spec.ordered) keys.sort();
      const out = {};
      for (const k of keys) {
        if (spec.key) check(spec.key, k, file, [...path, k]);
        out[k] = sub(spec.val, value[k], k);
      }
      return out;
    }
    case "one": {
      if (!isObj(value)) fail(`expected an object, got ${typeName(value)}`);
      const hit = spec.variants.find(([key]) => key in value);
      if (!hit) fail(`expected an object with one of the keys ${spec.variants.map(([k]) => k).join(", ")}`);
      return check(hit[1], value, file, path);
    }
    case "fn":
      return spec.f(value, fail, sub);
    default:
      throw new Error(`schema: unknown node ${spec.t}`);
  }
}

/** The overlay variant of a root record spec: same closed keys, plus `extra` fields, and only `schema` required. */
export function overlayOf(spec, extra = {}) {
  return { ...spec, fields: { ...spec.fields, ...extra }, req: ["schema"] };
}
