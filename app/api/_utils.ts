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

// app/api/_utils.ts  (only the ensureManagedContainers export below)
// ...keep your other imports/helpers as-is...
import { redisGet, redisSet } from "./_utils"; // your existing redis helpers

export async function ensureManagedContainers(notion: any, workspaceId: string) {
  const PAGE_KEY  = `managedpage:${workspaceId}`;
  const DB_KEY    = `rulesdb:${workspaceId}`;
  const PANEL_KEY = `managedpanel:${workspaceId}`;

  // --- 1) Parent page: "Recurio (Managed)" (back-compat: "Techwisely Managed")
  let pageId = await redisGet<string>(PAGE_KEY);
  if (!pageId) {
    try {
      const sr: any = await notion.search({
        query: "Recurio (Managed)",
        filter: { value: "page", property: "object" },
        page_size: 25,
      });
      pageId = sr.results?.find((r: any) => {
        const t =
          r.properties?.title?.title?.[0]?.plain_text ||
          r.title?.[0]?.plain_text ||
          "";
        return t === "Recurio (Managed)";
      })?.id;

      // Back-compat lookup for prior name
      if (!pageId) {
        const sr2: any = await notion.search({
          query: "Techwisely Managed",
          filter: { value: "page", property: "object" },
          page_size: 25,
        });
        pageId = sr2.results?.find((r: any) => {
          const t =
            r.properties?.title?.title?.[0]?.plain_text ||
            r.title?.[0]?.plain_text ||
            "";
          return t === "Techwisely Managed";
        })?.id;
      }
    } catch {}
  }
  if (!pageId) {
    // API supports { workspace: true } even if TS defs complain
    const created: any = await notion.pages.create({
      parent: { workspace: true } as any,
      icon: { type: "emoji", emoji: "🛠️" },
      properties: { title: { title: [{ text: { content: "Recurio (Managed)" } }] } },
    } as any);
    pageId = created.id;
    await redisSet(PAGE_KEY, pageId);
  }

  // --- 2) Rules DB: "Recurrence Rules (Managed)"
  let dbId = await redisGet<string>(DB_KEY);
  if (!dbId) {
    try {
      const searchDb: any = await notion.search({
        query: "Recurrence Rules (Managed)",
        filter: { value: "database", property: "object" },
        page_size: 25,
      });
      dbId = searchDb.results?.find((d: any) => {
        const t =
          d.title?.[0]?.plain_text ||
          d.properties?.title?.title?.[0]?.plain_text ||
          "";
        return t === "Recurrence Rules (Managed)";
      })?.id;
    } catch {}
  }
  if (!dbId) {
    const db: any = await notion.databases.create({
      parent: { page_id: pageId },
      title: [{ type: "text", text: { content: "Recurrence Rules (Managed)" } }],
      properties: {
        "Rule Name": { title: {} },
        "Task Page ID": { rich_text: {} },
        "Rule": {
          select: {
            options: [
              { name: "Daily" },
              { name: "Weekly" },
              { name: "Monthly" },
              { name: "Yearly" },
              { name: "Custom" },
            ],
          },
        },
        "By Day": {
          multi_select: { options: ["MO", "TU", "WE", "TH", "FR", "SA", "SU"].map((n) => ({ name: n })) },
        },
        "Interval": { number: {} },
        "Time": { rich_text: {} },
        "Timezone": { rich_text: {} },
        "Custom RRULE": { rich_text: {} },
        "Active": { checkbox: {} },
      },
    } as any);
    dbId = db.id;
    await redisSet(DB_KEY, dbId);
  }

  // --- 3) Panel page: "Recurio Dashboard" with an Embed to your app
  let panelId = await redisGet<string>(PANEL_KEY);
  if (!panelId) {
    try {
      const sr: any = await notion.search({
        query: "Recurio Dashboard",
        filter: { value: "page", property: "object" },
        page_size: 25,
      });
      panelId = sr.results?.find((r: any) => {
        const t =
          r.properties?.title?.title?.[0]?.plain_text ||
          r.title?.[0]?.plain_text ||
          "";
        return t === "Recurio Dashboard";
      })?.id;

      // Back-compat lookup for prior name
      if (!panelId) {
        const sr2: any = await notion.search({
          query: "Techwisely Recurrence Panel",
          filter: { value: "page", property: "object" },
          page_size: 25,
        });
        panelId = sr2.results?.find((r: any) => {
          const t =
            r.properties?.title?.title?.[0]?.plain_text ||
            r.title?.[0]?.plain_text ||
            "";
          return t === "Techwisely Recurrence Panel";
        })?.id;
      }
    } catch {}
  }
  if (!panelId) {
    const createdPanel: any = await notion.pages.create({
      parent: { page_id: pageId },
      icon: { type: "emoji", emoji: "🔁" },
      properties: { title: { title: [{ text: { content: "Recurio Dashboard" } }] } },
      children: [
        {
          object: "block",
          type: "embed",
          embed: { url: process.env.APP_URL || "https://example.com" },
        },
      ],
    } as any);
    panelId = createdPanel.id;
    await redisSet(PANEL_KEY, panelId);
  }

  return { pageId, dbId, panelId };
}
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
