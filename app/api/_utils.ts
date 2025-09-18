import { Client } from "@notionhq/client";
import { RRule, rrulestr } from "rrule";

// Upstash (REST)
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
export async function redisGet<T=any>(key: string): Promise<T|null> {
  const res = await r(`get/${encodeURIComponent(key)}`);
  if (res == null) return null;
  try { return JSON.parse(res) as T; } catch { return res as T; }
}
export async function redisSet(key: string, val: any) {
  const v = typeof val === "string" ? val : JSON.stringify(val);
  await r(`set/${encodeURIComponent(key)}/${encodeURIComponent(v)}`);
}

export function notionClient(token: string) {
  return new Client({ auth: token });
}

// ---- RRULE helpers
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
  if (time) { const [h, m="0"]=time.split(":"); now.setHours(Number(h), Number(m), 0, 0); }
  opts.dtstart = now;
  return new RRule(opts);
}

// ---- Workspace + Rules DB
export async function getWorkspaceIdFromToken(tok: any): Promise<string|null> {
  return tok?.workspace_id || null;
}

export async function ensureManagedContainers(
  notion: Client,
  workspaceId: string
): Promise<{ pageId: string; dbId: string }> {
  // Try cache
  let pageId: string | null = await redisGet<string>(`managedpage:${workspaceId}`);
  let dbId:   string | null = await redisGet<string>(`rulesdb:${workspaceId}`);

  // Create parent page if missing
  if (!pageId) {
    const p: any = await notion.pages.create({
      parent: { type: "workspace", workspace: true } as any,
      icon: { type: "emoji", emoji: "🗂️" },
      properties: { title: { title: [{ text: { content: "Techwisely (Managed)" } }] } }
    } as any);
    pageId = p.id as string;
    await redisSet(`managedpage:${workspaceId}`, pageId);
  }

  // Create Rules DB if missing; otherwise ensure key columns exist
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
        "By Day": { multi_select: { options: ["MO","TU","WE","TH","FR","SA","SU"].map(n => ({ name:n })) } },
        "Interval": { number: { format: "number" } },
        "Time": { rich_text: {} },
        "Timezone": { rich_text: {} },
        "Custom RRULE": { rich_text: {} },
        "Active": { checkbox: {} }
      }
    } as any);
    dbId = db.id as string;
    await redisSet(`rulesdb:${workspaceId}`, dbId);
  } else {
    const db: any = await notion.databases.retrieve({ database_id: dbId });
    const need: Record<string, any> = {};
    if (!db.properties?.["Task Page ID"]) need["Task Page ID"] = { rich_text: {} } as any;
    if (!db.properties?.["Rule Name"])    need["Rule Name"]    = { title: {} } as any;
    if (Object.keys(need).length) {
      await notion.databases.update({ database_id: dbId, properties: need } as any);
    }
  }

  // Final type guard for TS
  if (!pageId || !dbId) {
    throw new Error("Failed to ensure managed containers");
  }
  return { pageId: pageId!, dbId: dbId! };
}


  // rules DB
  if (!dbId) {
    const db:any = await notion.databases.create({
      parent: { type: "page_id", page_id: pageId },
      icon: { type: "emoji", emoji: "🔁" },
      title: [{ type: "text", text: { content: "Recurrence Rules (Managed)" } }],
      properties: {
        "Rule Name": { title: {} },
        "Task Page ID": { rich_text: {} },
        "Rule": { select: { options: [
          { name: "Daily" }, { name: "Weekly" }, { name: "Monthly" }, { name: "Yearly" }, { name: "Custom" }
        ]}},
        "By Day": { multi_select: { options: ["MO","TU","WE","TH","FR","SA","SU"].map(n => ({ name:n })) } },
        "Interval": { number: { format: "number" } },
        "Time": { rich_text: {} },
        "Timezone": { rich_text: {} },
        "Custom RRULE": { rich_text: {} },
        "Active": { checkbox: {} }
      }
    } as any);
    dbId = db.id;
    await redisSet(`rulesdb:${workspaceId}`, dbId);
  } else {
    // ensure key columns exist
    const db:any = await notion.databases.retrieve({ database_id: dbId });
    const need: Record<string, any> = {};
    if (!db.properties?.["Task Page ID"]) need["Task Page ID"] = { rich_text: {} } as any;
    if (!db.properties?.["Rule Name"])    need["Rule Name"]    = { title: {} } as any;
    if (Object.keys(need).length) {
      await notion.databases.update({ database_id: dbId, properties: need } as any);
    }
  }

  return { pageId, dbId };
}
