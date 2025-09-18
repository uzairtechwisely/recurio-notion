import { Client } from "@notionhq/client";
import { RRule, rrulestr } from "rrule";

// Upstash via REST
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

// ---- Recurrence helpers ----
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

// ---- Workspace + Rules DB management ----
export async function getWorkspaceIdFromToken(tok: any): Promise<string|null> {
  // Notion OAuth token usually includes workspace_id
  if (tok?.workspace_id) return tok.workspace_id as string;
  return null;
}

export async function ensureManagedContainers(notion: Client, workspaceId: string): Promise<{ pageId: string, dbId: string }> {
  // cache ids in Redis
  const cachedDb = await redisGet<string>(`rulesdb:${workspaceId}`);
  const cachedPage = await redisGet<string>(`managedpage:${workspaceId}`);
  if (cachedDb && cachedPage) return { pageId: cachedPage, dbId: cachedDb };

  // 1) Create (or re-use) a parent page for managed assets
  const pageId = cachedPage || await (async () => {
    const p:any = await notion.pages.create({
      parent: { type: "workspace", workspace: true } as any,
      icon: { type: "emoji", emoji: "🗂️" },
      properties: { title: { title: [{ text: { content: "Techwisely (Managed)" } }] } }
    } as any);
    await redisSet(`managedpage:${workspaceId}`, p.id);
    return p.id as string;
  })();

  // 2) Create the Rules DB if missing
  const dbId = cachedDb || await (async () => {
    const db:any = await notion.databases.create({
      parent: { type: "page_id", page_id: pageId },
      icon: { type: "emoji", emoji: "🔁" },
      title: [{ type: "text", text: { content: "Recurrence Rules (Managed)" } }],
      properties: {
        "Rule Name": { title: {} },
        "Task Page": { relation: { database_id: "placeholder", single_property: {} } } as any, // will patch below
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

    // Patch relation target after creation (Notion quirk avoided by users linking via UI; we can't know target DB here)
    // We'll set the relation target per-rule when creating pages via the 'rollup' style; for now we keep relation prop defined.
    await redisSet(`rulesdb:${workspaceId}`, db.id);
    return db.id as string;
  })();

  return { pageId, dbId };
}
