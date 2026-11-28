import { test } from "node:test";
import assert from "node:assert/strict";
import { addItem, cartOf } from "./src/cart.ts";
import { checkout } from "./src/checkout.ts";
import { reserve, setStock, stockOf } from "./src/inventory.ts";
import { awardPoints, pointsOf } from "./src/loyalty.ts";

const T = { timeout: 8000 };
const qtyIn = async (cart: string, sku: string) => (await cartOf(cart)).find((l) => l.sku === sku)?.qty ?? 0;

test("behavior: the last unit is sold once when two carts check out together", T, async () => {
  await setStock("mug1", 1);
  await addItem("a1", "mug1", 1);
  await addItem("a2", "mug1", 1);
  const [r1, r2] = await Promise.all([checkout("u1", "a1"), checkout("u2", "a2")]);
  assert.equal([r1, r2].filter((r) => r.ok).length, 1);
  assert.equal(await stockOf("mug1"), 0);
});
test("behavior: concurrent reserves never oversell", T, async () => {
  await setStock("mug2", 3);
  const results = await Promise.all(Array.from({ length: 6 }, () => reserve("mug2", 1)));
  assert.equal(results.filter(Boolean).length, 3);
  assert.equal(await stockOf("mug2"), 0);
});
test("root: concurrent point awards are all counted", T, async () => {
  await Promise.all(Array.from({ length: 8 }, () => awardPoints("ada", 5)));
  assert.equal(await pointsOf("ada"), 40);
});
test("root: failed checkouts leave stock unchanged and checkout does not hang", T, async () => {
  await setStock("cap", 4);
  await setStock("hat", 0);
  for (const c of ["d1", "d2", "d3"]) {
    await addItem(c, "cap", 1);
    await addItem(c, "hat", 1);
  }
  const rs = await Promise.all(["d1", "d2", "d3"].map((c, i) => checkout(`u${i}`, c)));
  assert.equal(rs.filter((r) => r.ok).length, 0);
  assert.equal(await stockOf("cap"), 4);
});
