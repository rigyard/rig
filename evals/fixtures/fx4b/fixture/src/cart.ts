import { get, set } from "./store.ts";

export interface Line { sku: string; qty: number }

export async function cartOf(cartId: string): Promise<Line[]> {
  return (await get<Line[]>(`cart:${cartId}`)) ?? [];
}

export async function addItem(cartId: string, sku: string, qty: number): Promise<void> {
  const lines = await cartOf(cartId);
  const line = lines.find((l) => l.sku === sku);
  if (line) line.qty += qty;
  else lines.push({ sku, qty });
  await set(`cart:${cartId}`, lines);
}

export async function clearCart(cartId: string): Promise<void> {
  await set(`cart:${cartId}`, []);
}
