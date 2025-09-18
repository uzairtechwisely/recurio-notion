import { Client } from "@notionhq/client";

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL!;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;

export async function redisGet<T = any>(key: string): Promise<T | null> {
  const r = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
  });
  const j = await r.json();
  if (!j?.result) return null;
  try { return JSON.parse(j.result) as T; } catch { return j.result as T; }
}
export async function redisSet(key: string, val: any) {
  const v = typeof val === "string" ? val : JSON.stringify(val);
  await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(v)}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
  });
}

export function notionClient(token: string) {
  return new Client({ auth: token });
}
