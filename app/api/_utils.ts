import { Client } from "@notionhq/client";
import { RRule, rrulestr } from "rrule";

// Upstash REST
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL!;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;

async function r(cmd: string) {
  const res = await fetch(`${REDIS_URL}/${cmd}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    cache: "no-store",
  });
  const j = await res.json().catch(() => ({}));
  return j?.result ?? null;
}

export async function redisGet<T = any>(key: string): Promise<T | null> {
  const res = await r(`get/${encodeURIComponent(key)}`);
  if (res == null) return null;
  try { return JSON.parse(res) as T; } catch { return res as T; }
}
export async function redisSet(key: string, val: any) {
  const v = typeof val === "string" ? val : JSON.stringify(val);
  await r(`set/${encodeURIComponent(key)}/${encodeURIComponent(v)}`);
}
export async function redisSAdd(setKey: string, member: string) {
  await r(`sadd/${encodeURIComponent(setKey)}/${encodeURIComponent(member)}`);
}
export async function redisSMembers(setKey: string): Promise<string[]> {
  const res = await r(`smembers/${encodeURIComponent(setKey)}`);
  try { return JSON.parse(res) } catch { return Array.isArray(res) ? res : []; }
}

export function notionClient(token: string) {
  return new Client({ auth: token });
}

export function buildRRule(input: {
  rule: string; byday?: string[]; interval?: number; time?: string; custom?: string;
}) {
  const { rule, byday = [], interval = 1, time, custom } = input;

  if (rule === "Custom" && custom) return rrulestr(custom);

  const opts: any = { freq: RRule.DAILY, interval: Number(interval || 1) };
  if (rule === "Weekly") { opts.freq = RRule.WEEKLY; if (byday.length) opts.byweekday = byday.map(d => (RRule as any)[d]); }
  if (rule === "Monthly") opts.freq = RRule.MONTHLY;
  if (rule === "Yearly")  opts.freq = RRule.YEARLY;

  const now = new Date();
  if (time) {
    const [h, m = "0"] = time.split(":");
    now.setHours(Number(h), Number(m), 0, 0);
  }
  opts.dtstart = now;
  return new RRule(opts);
}
