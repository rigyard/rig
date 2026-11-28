import { get, set } from "./store.ts";

export async function pointsOf(userId: string): Promise<number> {
  return (await get<number>(`points:${userId}`)) ?? 0;
}

export async function awardPoints(userId: string, points: number): Promise<void> {
  const current = await pointsOf(userId);
  await set(`points:${userId}`, current + points);
}
