// app/api/worker/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { noStoreJson } from "../_http";
import { notionClient } from "../_utils";
import { adoptTokenForThisSession } from "../_session";
import { extractTitle, extractDueISO, isTaskDone } from "../_props";

/* ---------------- utilities ---------------- */

type RuleCfg = {
  taskPageId: string;
  rule: "Daily" | "Weekly" | "Monthly" | "Yearly" | "Custom";
  byday: string[];         // MO,TU,...
  interval: number;        // >=1
  time?: string | null;    // "HH:mm"
  tz?: string | null;      // unused (MVP), kept for future TZ calc
  custom?: string | null;  // RRULE string (best-effort)
  rulePageId: string;      // rules db page id
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
  if (!allowed.length) return addDays(base, 7 * interval); // fallback: same weekday + interval weeks
  // start from +1 minute to avoid re-creating same minute
  let cand = new Date(base.getTime() + 60_000);
  for (let i = 0; i < 370; i++) {
    const wday = cand.getDay();
    if (allowed.includes(wday)) {
      // week spacing check vs base week
      const weeks = Math.floor((cand.getTime() - base.getTime()) / (7 * 86400_000));
      if (weeks % interval === 0) return cand;
    }
    cand = addDays(cand, 1);
  }
  return addDays(base, 7 * interval);
}

function parseCustomRRule(s: string): Partial<RuleCfg> {
  // Very small RRULE parser (supports FREQ, INTERVAL, BYDAY, BYMONTHDAY, BYMONTH)
  const out: Partial<RuleCfg> = {};
  const parts = s.split(";").map(p => p.trim()).filter(Boolean);
  for (const p of parts) {
    const [k, v] = p.split("=").map(x => (x || "").trim().toUpperCase());
    if (!k) continue;
    if (k === "FREQ" && (["DAILY","WEEKLY","MONTHLY","YEARLY"] as any).includes(v)) (out as any).rule = v.charAt(0) + v.slice(1).toLowerCase() as any;
    if (k === "INTERVAL" && /^\d+$/.test(v)) out.interval = Math.max(1, parseInt(v, 10));
    if (k === "BYDAY") out.byday = v.split(",").map(x => x.trim()).filter(Boolean);
    // We don’t fully implement BYMONTH/BYMONTHDAY here, but we keep them for future extension.
  }
  return out;
}

function computeNextDue(baseISO: string | null, cfg: RuleCfg): string {
  const base = baseISO ? new Date(baseISO) : new Date();
  const interval = Math.max(1, cfg.interval || 1);
  let next: Date;

  if (cfg.rule === "Custom" && cfg.custom) {
    const rr = parseCustomRRule(cfg.custom);
    const freq = (rr.rule as RuleCfg["rule"]) || cfg.rule;
    const byday = rr.byday || cfg.byday || [];
    const ii = rr.interval || interval;

    if (freq === "Daily") {
      next = addDays(base, ii);
    } else if (freq === "Weekly") {
      next = nextWeeklyFrom(base, byday, ii);
    } else if (freq === "Monthly") {
      next = addMonths(base, ii);
    } else if (freq === "Yearly") {
      next = addYears(base, ii);
    } else {
      next = addDays(base, ii);
    }
  } else {
    if (cfg.rule === "Daily") {
      next = addDays(base, interval);
    } else if (cfg.rule === "Weekly") {
      const by = cfg.byday && cfg.byday.length ? cfg.byday : [Object.keys(BYDAY_MAP)[base.getDay()]];
      next = nextWeeklyFrom(base, by, interval);
    } else if (cfg.rule === "Monthly") {
      next = addMonths(base, interval);
    } else if (cfg.rule === "Yearly") {
      next = addYears(base, interval);
    } else {
      next = addDays(base, interval);
    }
  }

  next = withTime(next, cfg.time || null);
  // Ensure strictly in the future
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
  // first date prop
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

/* ---------------- route ---------------- */

export async function POST(req: Request) {
  const { tok } = await adoptTokenForThisSession();
  if (!tok?.access_token) return noStoreJson({ ok:false, processed:0, created:0, details:[], error:"not_connected" }, 401);
  const notion = notionClient(tok.access_token);

  const body = await req.json().catch(() => ({} as any));
  const onlyDbId = (body?.dbId || "").trim() || null;

  try {
    // 1) find the rules DB
    const rulesDb: any = await searchOne(notion, "Recurrence Rules (Managed)", "database");
    if (!rulesDb?.id) {
      return noStoreJson({ ok:true, processed:0, created:0, details:[{ note:"no_rules_db" }] });
    }

    // 2) fetch active rules (fallback to all if "Active" missing)
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

    // 3) iterate rules
    for (const r of rules) {
      processed++;
      const props = (r as any)?.properties || {};

      // Extract config from rule row
      const taskPageId = String(
        (props["Task Page ID"]?.rich_text?.[0]?.plain_text) ||
        (props["Task Page ID"]?.rich_text?.[0]?.text?.content) ||
        ""
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
        time,
        tz,
        custom,
        rulePageId: (r as any).id
      };

      // Load the task
      let task: any;
      try {
        task = await notion.pages.retrieve({ page_id: taskPageId });
      } catch (e: any) {
        details.push({ from: taskPageId, note: "task_not_found_or_no_access" });
        continue;
      }
      if (task?.archived) { details.push({ from: taskPageId, note: "task_archived" }); continue; }

      const tProps = task?.properties || {};
      const title = extractTitle(tProps);
      const dueISO = extractDueISO(tProps);
      const done = isTaskDone(tProps);

      // parent DB
      const parentDbId = task?.parent?.type === "database_id" ? task.parent.database_id : null;
      if (onlyDbId && parentDbId && onlyDbId !== parentDbId) {
        details.push({ from: taskPageId, note: "skipped_other_db" });
        continue;
      }

      // We only create a next task when this one is marked done
      if (!done) { details.push({ from: taskPageId, note: "not_done" }); continue; }

      // Compute next due
      const nextISO = computeNextDue(dueISO, cfg);

      // Find DB schema to get real property ids (title + date)
      if (!parentDbId) { details.push({ from: taskPageId, note:"no_parent_db" }); continue; }
      const dbMeta: any = await notion.databases.retrieve({ database_id: parentDbId }).catch(() => null);
      if (!dbMeta) { details.push({ from: taskPageId, note:"db_meta_failed" }); continue; }
      const dbProps = dbMeta.properties || {};
     // title prop id (use explicit tuple typing so TS knows .id exists)
const titlePropId: string = (() => {
  const entry = Object.entries(dbProps).find(
    ([, v]: [string, any]) => (v as any)?.type === "title"
  );
  return entry ? ((entry[1] as any).id ?? "title") : "title";
})();

// date prop id: prefer the task’s actual date prop id, else first date prop in DB
const dueKeyId: string | undefined = (() => {
  const fromTask = preferDateKey(tProps).id;
  if (fromTask) return fromTask;
  const entry = Object.entries(dbProps).find(
    ([, v]: [string, any]) => (v as any)?.type === "date"
  );
  return entry ? ((entry[1] as any).id as string) : undefined;
})();
      // Build new page properties
      const propsNew: any = {
        [titlePropId]: { title: [{ text: { content: title } }] }
      };
      if (dueKeyId) {
        propsNew[dueKeyId] = { date: { start: nextISO } };
      }

      // Create page
      let newTask: any;
      try {
        newTask = await notion.pages.create({
          parent: { database_id: parentDbId },
          properties: propsNew
        } as any);
      } catch (e: any) {
        details.push({ from: taskPageId, note: `create_failed:${e?.message || String(e)}` });
        continue;
      }

      // Move rule to the new task (so next sync won’t recreate)
      try {
        await notion.pages.update({
          page_id: cfg.rulePageId,
          properties: {
            "Task Page ID": { rich_text: [{ type: "text", text: { content: newTask.id } }] }
          }
        } as any);
      } catch (e: any) {
        // If property was renamed (unlikely if you used reset-managed), we just skip moving but still count creation
      }

      created++;
      details.push({ from: taskPageId, to: newTask.id, title, movedRule: true });
    }

    return noStoreJson({ ok:true, processed, created, details });
  } catch (e: any) {
    return noStoreJson({ ok:false, processed:0, created:0, details:[], error:"worker_failed", detail: e?.message || String(e) }, 500);
  }
}
