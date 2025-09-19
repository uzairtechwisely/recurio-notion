type KV = Map<string, string>;
const g = globalThis as any;
if (!g.__RECURIO_MEMO__) g.__RECURIO_MEMO__ = new Map<string, string>();
const store: KV = g.__RECURIO_MEMO__;

export async function redisSet(key: string, value: any) {
  store.set(key, JSON.stringify(value));
}
export async function redisGet<T = any>(key: string): Promise<T | null> {
  const raw = store.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}
export async function redisDel(key: string) {
  store.delete(key);
}
