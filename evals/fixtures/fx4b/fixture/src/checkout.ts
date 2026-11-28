import { cartOf, clearCart } from "./cart.ts";
import { release, reserve } from "./inventory.ts";
import { awardPoints } from "./loyalty.ts";

export type CheckoutResult = { ok: true } | { ok: false; outOfStock: string };

/** Reserves every line of the cart, or nothing at all. One loyalty point per unit bought. */
export async function checkout(userId: string, cartId: string): Promise<CheckoutResult> {
  const lines = await cartOf(cartId);
  const taken: typeof lines = [];
  for (const line of lines) {
    if (!(await reserve(line.sku, line.qty))) {
      for (const t of taken) await release(t.sku, t.qty);
      return { ok: false, outOfStock: line.sku };
    }
    taken.push(line);
  }
  await awardPoints(userId, lines.reduce((n, l) => n + l.qty, 0));
  await clearCart(cartId);
  return { ok: true };
}
