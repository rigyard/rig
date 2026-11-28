import { get, set } from "./store.ts";

export async function setStock(sku: string, units: number): Promise<void> {
  await set(`stock:${sku}`, units);
}

export async function stockOf(sku: string): Promise<number> {
  return (await get<number>(`stock:${sku}`)) ?? 0;
}

/** Takes `qty` units off the shelf. Returns false, changing nothing, when there are not enough. */
export async function reserve(sku: string, qty: number): Promise<boolean> {
  const left = await stockOf(sku);
  if (left < qty) return false;
  await set(`stock:${sku}`, left - qty);
  return true;
}

export async function release(sku: string, qty: number): Promise<void> {
  const left = await stockOf(sku);
  await set(`stock:${sku}`, left + qty);
}
