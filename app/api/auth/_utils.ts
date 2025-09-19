import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

// tiny wrappers so our callsites stay clean
export async function redisSet<T>(
  key: string,
  value: T,
  ttlSeconds?: number
) {
  return ttlSeconds
    ? redis.set(key, value as any, { ex: ttlSeconds })
    : redis.set(key, value as any);
}

export async function redisGet<T = unknown>(key: string) {
  return (await redis.get<T>(key)) ?? null;
}

export async function redisDel(key: string | string[]) {
  if (Array.isArray(key)) return redis.del(...key);
  return redis.del(key);
}