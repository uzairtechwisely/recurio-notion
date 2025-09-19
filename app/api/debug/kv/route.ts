export const runtime = "edge";
export const fetchCache = "force-no-store";

import { Redis } from "@upstash/redis";
const redis = Redis.fromEnv();

export async function GET() {
  const key = "kv:smoke";
  const ts = Date.now();
  await redis.set(key, ts, { ex: 60 });
  const read = await redis.get<number>(key);
  return Response.json({ ok: read === ts, ts, read });
}