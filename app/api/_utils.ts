import { Client } from "@notionhq/client";
import { RRule, rrulestr } from "rrule";

// -------- Upstash (REST) ----------
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
  try { return JSON.parse(res); } catch { return Array.isArray(res) ? (res as string[]) : []; }
}

export async function redisDel(key: string) {
  await r(`del/${encodeURIComponent(key)}`);
}

// -------- Notion helpers ----------
export function notionClient(token: string) {
  return new Client({ auth: token });
}

// RRULE builder (supports presets or a custom string)
export function buildRRule(input: {
  rule: string; byday?: string[]; interval?: number; time?: string; custom?: string;
}) {
  const { rule, byday = [], interval = 1, time, custom } = input;
  if (rule === "Custom" && custom) return rrulestr(custom);

  const opts: any = { freq: RRule.DAILY, interval: Number(interval || 1) };
  if (rule === "Weekly") { opts.freq = RRule.WEEKLY; if (byday.length) opts.byweekday = byday.map((d) => (RRule as any)[d]); }
  if (rule === "Monthly") opts.freq = RRule.MONTHLY;
  if (rule === "Yearly")  opts.freq = RRule.YEARLY;

  const dt = new Date();
  if (time) { const [h, m = "0"] = time.split(":"); dt.setHours(Number(h), Number(m), 0, 0); }
  opts.dtstart = dt;
  return new RRule(opts);
}

// Workspace id from OAuth token (if present)
export async function getWorkspaceIdFromToken(tok: any): Promise<string | null> {
  return tok?.workspace_id || null;
}

// Ensure: parent page "Techwisely (Managed)" and child DB "Recurrence Rules (Managed)"
export async function ensureManagedContainers(
  notion: Client,
  workspaceId: string
): Promise<{ pageId: string; dbId: string }> {
  // Try cache
  let pageId: string | null = await redisGet<string>(`managedpage:${workspaceId}`);
  let dbId: string | null = await redisGet<string>(`rulesdb:${workspaceId}`);

  // Create parent page if missing
  if (!pageId) {
    const p: any = await notion.pages.create({
      parent: { type: "workspace", workspace: true } as any,
      icon: { type: "emoji", emoji: "🗂️" },
      properties: { title: { title: [{ text: { content: "Techwisely (Managed)" } }] } },
    } as any);
    pageId = p.id as string;
    await redisSet(`managedpage:${workspaceId}`, pageId);
  }

  // Create rules DB if missing; else ensure key columns exist
  if (!dbId) {
    const db: any = await notion.databases.create({
      parent: { type: "page_id", page_id: pageId },
      icon: { type: "emoji", emoji: "🔁" },
      title: [{ type: "text", text: { content: "Recurrence Rules (Managed)" } }],
      properties: {
        "Rule Name": { title: {} },
        "Task Page ID": { rich_text: {} },
        "Rule": { select: { options: [
          { name: "Daily" }, { name: "Weekly" }, { name: "Monthly" }, { name: "Yearly" }, { name: "Custom" }
        ]}},
        "By Day": { multi_select: { options: ["MO","TU","WE","TH","FR","SA","SU"].map((n) => ({ name: n })) } },
        "Interval": { number: { format: "number" } },
        "Time": { rich_text: {} },
        "Timezone": { rich_text: {} },
        "Custom RRULE": { rich_text: {} },
        "Active": { checkbox: {} },
      },
    } as any);
    dbId = db.id as string;
    await redisSet(`rulesdb:${workspaceId}`, dbId);
  } else {
    const existing: any = await notion.databases.retrieve({ database_id: dbId });
    const patch: Record<string, any> = {};
    if (!existing.properties?.["Task Page ID"]) patch["Task Page ID"] = { rich_text: {} } as any;
    if (!existing.properties?.["Rule Name"]) patch["Rule Name"] = { title: {} } as any;
    if (Object.keys(patch).length) {
      await notion.databases.update({ database_id: dbId, properties: patch } as any);
    }
  }

  if (!pageId || !dbId) throw new Error("Failed to ensure managed containers");
  return { pageId, dbId };
}
