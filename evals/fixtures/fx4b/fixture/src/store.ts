const data = new Map<string, unknown>();

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

export async function get<T>(key: string): Promise<T | undefined> {
  await tick();
  return data.get(key) as T | undefined;
}

export async function set(key: string, value: unknown): Promise<void> {
  await tick();
  data.set(key, value);
}
