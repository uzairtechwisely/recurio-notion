// app/api/worker/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { noStoreJson } from "../_http";
import { notionClient } from "../_utils";
import { getTokenFromRequest } from "../../_session";
import { extractTitle, extractDueISO, isTaskDone } from "../_props";

type RuleCfg = {
  taskPageId: string;
  rule: "Daily" | "Weekly" | "Monthly" | "Yearly" | "Custom";
  byday: string[];
  interval: number;
  time?: string | null;
  tz?: string | null;
  custom?: string | null;
  rulePageId: string;
};

function addDays(d: Date, n: number) { const x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
function addMonths(d: Date, n: number) { const x = new Date(d.getTime()); x.setMonth(x.getMonth() + n); return x; }
function addYears(d: Date, n: number) { const x = new Date(d.getTime()); x.setFullYear(x.getFullYear() + n); return x; }
function withTime(base: Date, hhmm?: string | null) {
  if (!hhmm) return base;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return base;
  const h = Math.max(0, Math.min(23, parseInt(m[1], 10)));
  const mi = Math.max(0, Math.min(59, parseInt(m[2], 10)));
  const x = new Date(base.getTime());
  x.setHours(h, mi, 0, 0);
  return x;
}
const BYDAY_MAP: Record<string, number> = { SU:0, MO:1, TU:2, WE:3, TH:4, FR:5, SA:6 };

function nextWeeklyFrom(base: Date, byday: string[], interval: number) {
  const allowed = byday.map(d => BYDAY_MAP[d]).filter(n => n != null);
  if (!allowed.length) return addDays(base, 7 * interval);
  let cand = new Date(base.getTime() + 60_000); // at least +1 min
  for (let i = 0; i < 370; i++) {
    const wday = cand.getDay();
    if (allowed.includes(wday)) {
      const weeks = Math.floor((cand.getTime() - base.getTime()) / (7 * 86400_000));
      if (weeks % interval === 0) return cand;
    }
    cand = addDays(cand, 1);
  }
  return addDays(base, 7 * interval);
}

function parseCustomRRule(s: string): Partial<RuleCfg> {
  const out: Partial<RuleCfg> = {};
  const parts = s.split(";").map(p => p.trim()).filter(Boolean);
  for (const p of parts) {
    const [k, v] = p.split("=").map(x => (x || "").trim().toUpperCase());
    if (!k) continue;
    if (k === "FREQ" && ["DAILY","WEEKLY","MONTHLY","YEARLY"].includes(v)) (out as any).rule = v.charAt(0) + v.slice(1).toLowerCase() as any;
    if (k === "INTERVAL" && /^\d+$/.test(v)) out.interval = Math.max(1, parseInt(v, 10));
    if (k === "BYDAY") out.byday = v.split(",").map(x => x.trim()).filter(Boolean);
  }
  return out;
}

function computeNextDueStrict(baseISO: string | null, cfg: RuleCfg): string {
  const base = baseISO ? new Date(baseISO) : new Date();
  const interval = Math.max(1, cfg.interval || 1);
  let next: Date;

  const step = (d: Date): Date => {
    if (cfg.rule === "Custom" && cfg.custom) {
      const rr = parseCustomRRule(cfg.custom);
      const freq = (rr.rule as RuleCfg["rule"]) || cfg.rule;
      const byday = rr.byday || cfg.byday || [];
      const ii = rr.interval || interval;
      if (freq === "Daily") return addDays(d, ii);
      if (freq === "Weekly") return nextWeeklyFrom(d, byday, ii);
      if (freq === "Monthly") return addMonths(d, ii);
      if (freq === "Yearly") return addYears(d, ii);
      return addDays(d, ii);
    } else {
      if (cfg.rule === "Daily") return addDays(d, interval);
      if (cfg.rule === "Weekly") {
        const by = cfg.byday && cfg.byday.length ? cfg.byday : [Object.keys(BYDAY_MAP)[d.getDay()]];
        return nextWeeklyFrom(d, by, interval);
      }
      if (cfg.rule === "Monthly") return addMonths(d, interval);
      if (cfg.rule === "Yearly") return addYears(d, interval);
      return addDays(d, interval);
    }
  };

  next = step(base);
  next = withTime(next, cfg.time || null);

  // ensure strictly after the existing due (not same day/minute)
  const floor = new Date(base.getTime() + 60_000);
  let guard = 0;
  while (next.getTime() <= floor.getTime() && guard < 12) {
    next = withTime(step(next), cfg.time || null);
    guard++;
  }
  // also ensure in the future
  if (next.getTime() <= Date.now()) next = new Date(Date.now() + 60_000);

  return next.toISOString();
}

function preferDateKey(props: any): { key?: string, id?: string } {
  const preferNames = ["due","deadline","date","when","start","scheduled","starts"];
  const entries = Object.entries(props || {}) as Array<[string, any]>;
  const dateEntries = entries.filter(([,v]) => v?.type === "date");
  if (!dateEntries.length) return {};
  const lower = dateEntries.map(([k,v]) => [k, (v as any).id, k.toLowerCase()] as [string,string,string]);
  for (const p of preferNames) {
    const hit = lower.find(([, , name]) => name.includes(p));
    if (hit) return { key: hit[0], id: hit[1] };
  }
  return { key: dateEntries[0][0], id: (dateEntries[0][1] as any)?.id };
}

async function searchOne(notion: any, query: string, object: "page" | "database") {
  const r = await notion.search({
    query,
    filter: { value: object, property: "object" },
    sort: { direction: "descending", timestamp: "last_edited_time" }
  } as any);
  return (r?.results || [])[0] || null;
}

export async function POST(req: Request) {
  const tok = await getTokenFromRequest<any>();
if (!tok?.access_token) return noStoreJson({ ok: false, error: "no_token" }, 401);
const notion = notionClient(tok.access_token);

  const body = await req.json().catch(() => ({} as any));
  const onlyDbId = (body?.dbId || "").trim() || null;

  try {
    // rules DB
    const rulesDb: any = await searchOne(notion, "Recurrence Rules (Managed)", "database");
    if (!rulesDb?.id) return noStoreJson({ ok:true, processed:0, created:0, details:[{ note:"no_rules_db" }] });

    // active rules (fallback to all)
    let rulesQuery: any;
    try {
      rulesQuery = await notion.databases.query({
        database_id: rulesDb.id,
        filter: { property: "Active", checkbox: { equals: true } },
        page_size: 100
      });
    } catch {
      rulesQuery = await notion.databases.query({ database_id: rulesDb.id, page_size: 100 });
    }

    const rules = rulesQuery?.results || [];
    let processed = 0, created = 0;
    const details: Array<{ from: string; to?: string; title?: string; movedRule?: boolean; note?: string }> = [];

    for (const r of rules) {
      processed++;
      const props = (r as any)?.properties || {};
      const taskPageId = String(
        props["Task Page ID"]?.rich_text?.[0]?.plain_text ||
        props["Task Page ID"]?.rich_text?.[0]?.text?.content || ""
      ).trim();
      if (!taskPageId) { details.push({ from:"", note:"missing_task_id" }); continue; }

      const ruleSel = props["Rule"]?.select?.name as RuleCfg["rule"] | undefined;
      const byday = (props["By Day"]?.multi_select || []).map((o: any) => String(o?.name || "").toUpperCase()).filter(Boolean);
      const interval = Number(props["Interval"]?.number || 1);
      const time = (props["Time"]?.rich_text?.[0]?.plain_text || props["Time"]?.rich_text?.[0]?.text?.content || "") || null;
      const tz = (props["Timezone"]?.rich_text?.[0]?.plain_text || props["Timezone"]?.rich_text?.[0]?.text?.content || "") || null;
      const custom = (props["Custom RRULE"]?.rich_text?.[0]?.plain_text || props["Custom RRULE"]?.rich_text?.[0]?.text?.content || "") || null;

      const cfg: RuleCfg = {
        taskPageId,
        rule: (ruleSel as any) || "Weekly",
        byday,
        interval: Number.isFinite(interval) ? Math.max(1, interval) : 1,
        time, tz, custom,
        rulePageId: (r as any).id
      };

      // load task
      let task: any;
      try {
        task = await notion.pages.retrieve({ page_id: taskPageId });
      } catch {
        details.push({ from: taskPageId, note: "task_not_found_or_no_access" });
        continue;
      }
      if (task?.archived) { details.push({ from: taskPageId, note: "task_archived" }); continue; }

      const tProps = task?.properties || {};
      const title = extractTitle(tProps);
      const dueISO = extractDueISO(tProps);
      const done = isTaskDone(tProps);

      const parentDbId = task?.parent?.type === "database_id" ? task.parent.database_id : null;
      if (onlyDbId && parentDbId && onlyDbId !== parentDbId) { details.push({ from: taskPageId, note: "skipped_other_db" }); continue; }

      // only advance when done
      if (!done) { details.push({ from: taskPageId, note: "not_done" }); continue; }

      const nextISO = computeNextDueStrict(dueISO, cfg);

      if (!parentDbId) { details.push({ from: taskPageId, note:"no_parent_db" }); continue; }
      const dbMeta: any = await notion.databases.retrieve({ database_id: parentDbId }).catch(() => null);
      if (!dbMeta) { details.push({ from: taskPageId, note:"db_meta_failed" }); continue; }
      const dbProps = dbMeta.properties || {};

      const titlePropId: string = (() => {
        const entry = Object.entries(dbProps).find(([, v]: [string, any]) => (v as any)?.type === "title");
        return entry ? ((entry[1] as any).id ?? "title") : "title";
      })();
      const dueKeyId: string | undefined = (() => {
        const fromTask = (Object.values(tProps || {}) as any[]).find((p: any) => p?.type === "date")?.id;
        if (fromTask) return fromTask as string;
        const entry = Object.entries(dbProps).find(([, v]: [string, any]) => (v as any)?.type === "date");
        return entry ? ((entry[1] as any).id as string) : undefined;
      })();

      const propsNew: any = { [titlePropId]: { title: [{ text: { content: title } }] } };
      if (dueKeyId) propsNew[dueKeyId] = { date: { start: nextISO } };

      // create next task
      let newTask: any;
      try {
        newTask = await notion.pages.create({ parent: { database_id: parentDbId }, properties: propsNew } as any);
      } catch (e: any) {
        details.push({ from: taskPageId, note: `create_failed:${e?.message || String(e)}` });
        continue;
      }

      // move rule to new task
      try {
        await notion.pages.update({
          page_id: cfg.rulePageId,
          properties: { "Task Page ID": { rich_text: [{ type: "text", text: { content: newTask.id } }] } }
        } as any);
      } catch {}

      created++;
      details.push({ from: taskPageId, to: newTask.id, title, movedRule: true });
    }

    return noStoreJson({ ok:true, processed, created, details });
  } catch (e: any) {
    return noStoreJson({ ok:false, processed:0, created:0, details:[], error:"worker_failed", detail: e?.message || String(e) }, 500);
  }
}
