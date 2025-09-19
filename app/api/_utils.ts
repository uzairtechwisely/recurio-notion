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

export async function exchangeCodeForToken(code: string, redirectUri: string) {
  const cid = process.env.NOTION_CLIENT_ID;
  const secret = process.env.NOTION_CLIENT_SECRET;
  if (!cid || !secret) {
    throw new Error("Missing NOTION_CLIENT_ID / NOTION_CLIENT_SECRET");
  }

  // Build Basic auth safely in Node or Edge
  let basicCreds = "";
  try {
    // Node.js
    // @ts-ignore
    basicCreds = Buffer.from(`${cid}:${secret}`).toString("base64");
  } catch {
    // Edge/browser fallback
    // @ts-ignore
    basicCreds = (globalThis as any).btoa?.(`${cid}:${secret}`) || "";
  }
  const authHeader = `Basic ${basicCreds}`;

  const res = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
      // Notion-Version not required for OAuth, but harmless if you keep a default fetch wrapper
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`token_exchange_failed ${res.status}: ${text}`);
  }

  // Shape: { access_token, workspace_id, bot_id, owner, duplicated_template_id?, ... }
  const token = await res.json();
  return token;
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



// REPLACE just this function in app/api/_utils.ts
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
        page_size: 50,
      });
      pageId = sr.results?.find((r: any) => {
        const t =
          r.properties?.title?.title?.[0]?.plain_text ||
          r.title?.[0]?.plain_text ||
          "";
        return t === "Recurio (Managed)";
      })?.id;

      if (!pageId) {
        const sr2: any = await notion.search({
          query: "Techwisely Managed",
          filter: { value: "page", property: "object" },
          page_size: 50,
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
    const created: any = await notion.pages.create({
      parent: { workspace: true } as any, // API supports this at runtime
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
      const sdb: any = await notion.search({
        query: "Recurrence Rules (Managed)",
        filter: { value: "database", property: "object" },
        page_size: 50,
      });
      dbId = sdb.results?.find((d: any) => {
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
          multi_select: {
            options: ["MO", "TU", "WE", "TH", "FR", "SA", "SU"].map((n) => ({ name: n })),
          },
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

  // --- 3) Panel page: "Recurio Dashboard" (back-compat: "Techwisely Recurrence Panel")
  let panelId = await redisGet<string>(PANEL_KEY);
  if (!panelId) {
    try {
      const srp: any = await notion.search({
        query: "Recurio Dashboard",
        filter: { value: "page", property: "object" },
        page_size: 50,
      });
      panelId = srp.results?.find((r: any) => {
        const t =
          r.properties?.title?.title?.[0]?.plain_text ||
          r.title?.[0]?.plain_text ||
          "";
        return t === "Recurio Dashboard";
      })?.id;

      if (!panelId) {
        const srp2: any = await notion.search({
          query: "Techwisely Recurrence Panel",
          filter: { value: "page", property: "object" },
          page_size: 50,
        });
        panelId = srp2.results?.find((r: any) => {
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

  if (!pageId || !dbId) throw new Error("Failed to ensure managed containers");
  return { pageId, dbId, panelId };
}
