// app/api/worker/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { noStoreJson } from "../_http";
import { notionClient, ensureManagedContainers, getWorkspaceIdFromToken } from "../_utils";
import { adoptTokenForThisSession } from "../_session";

function nextFrom(rule: string, byday: string[], interval: number, baseISO: string): string | null {
  const base = new Date(baseISO);
  if (Number.isNaN(+base)) return null;
  const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

  if (rule === "Daily") return addDays(base, Math.max(1, interval || 1)).toISOString();

  if (rule === "Weekly") {
    const weekdays = ["SU","MO","TU","WE","TH","FR","SA"];
    const list = byday.length ? byday.map(s => weekdays.indexOf(s)).filter(n => n >= 0).sort((a,b)=>a-b) : [base.getUTCDay()];
    for (let i = 1; i <= 7; i++) {
      const cand = addDays(base, i);
      if (list.includes(cand.getUTCDay())) return cand.toISOString();
    }
    return addDays(base, 7 * Math.max(1, interval || 1)).toISOString();
  }

  if (rule === "Monthly") {
    const m = Math.max(1, interval || 1);
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + m, base.getUTCDate(), base.getUTCHours(), base.getUTCMinutes(), base.getUTCSeconds()));
    return d.toISOString();
  }

  if (rule === "Yearly") {
    const y = Math.max(1, interval || 1);
    const d = new Date(Date.UTC(base.getUTCFullYear() + y, base.getUTCMonth(), base.getUTCDate(), base.getUTCHours(), base.getUTCMinutes(), base.getUTCSeconds()));
    return d.toISOString();
  }

  return addDays(base, 1).toISOString();
}

function pickTitle(props: any): string {
  for (const k of Object.keys(props || {})) {
    const p = props[k];
    if (p?.type === "title") {
      const arr = p?.title || [];
      return arr.map((t: any) => t?.plain_text || t?.text?.content || "").join("").trim() || "Untitled";
    }
  }
  return "Untitled";
}
function isDone(props: any): boolean {
  for (const k of Object.keys(props || {})) {
    const p = props[k];
    if (p?.type === "checkbox") return !!p?.checkbox;
  }
  for (const k of Object.keys(props || {})) {
    const p = props[k];
    if (p?.type === "status") {
      const name = p?.status?.name || "";
      if (String(name).toLowerCase() === "done") return true;
    }
  }
  return false;
}
function getDueISO(props: any): string | null {
  for (const k of Object.keys(props || {})) {
    const p = props[k];
    if (p?.type === "date") {
      const v = p?.date;
      if (v?.end) return v.end;
      if (v?.start) return v.start;
    }
  }
  return null;
}

export async function GET() {
  const { tok } = await adoptTokenForThisSession();
  if (!tok?.access_token) return noStoreJson({ ok: false, error: "no token" }, 401);
  const notion = notionClient(tok.access_token);

  let processed = 0, created = 0;
  const details: any[] = [];

  try {
    const workspaceId = (await getWorkspaceIdFromToken(tok)) || tok.workspace_id;
    if (!workspaceId) return noStoreJson({ ok: false, error: "no workspace id" }, 400);

    const { dbId: rulesDb } = await ensureManagedContainers(notion, workspaceId);
    if (!rulesDb) return noStoreJson({ ok: false, error: "rules db missing" }, 500);

    const rr: any = await notion.databases.query({
      database_id: rulesDb,
      filter: { property: "Active", checkbox: { equals: true } },
      page_size: 100,
    });

    for (const r of rr?.results || []) {
      const props = (r as any).properties || {};
      const taskId = (props?.["Task Page ID"]?.rich_text?.[0]?.plain_text || props?.["Task Page ID"]?.rich_text?.[0]?.text?.content || "").trim();
      const rule = props?.["Rule"]?.select?.name || "Weekly";
      const byday = (props?.["By Day"]?.multi_select || []).map((m: any) => m?.name).filter(Boolean);
      const interval = Number(props?.["Interval"]?.number || 1);
      const custom = (props?.["Custom RRULE"]?.rich_text?.[0]?.plain_text || props?.["Custom RRULE"]?.rich_text?.[0]?.text?.content || "").trim();

      if (!taskId) continue;

      let task: any;
      try { task = await notion.pages.retrieve({ page_id: taskId }); } catch { continue; }

      const tProps = task.properties || {};
      const title = pickTitle(tProps);
      const due = getDueISO(tProps);
      const done = isDone(tProps);

      processed++;
      if (!done || !due) continue;

      const baseISO = due;
      const nextISO = custom ? nextFrom("Daily", [], 1, baseISO) : nextFrom(rule, byday, interval, baseISO);
      if (!nextISO) continue;

      const parentDb = task?.parent?.database_id;
      if (!parentDb) continue;

      const createdPage: any = await notion.pages.create({
        parent: { database_id: parentDb },
        properties: {
          ...(Object.fromEntries(Object.entries(tProps).filter(([, p]: any) => p?.type === "title").map(([k]) => [k, tProps[k]]))),
          ...(Object.fromEntries(Object.entries(tProps).filter(([, p]: any) => p?.type === "date").slice(0, 1).map(([k]) => [k, { date: { start: nextISO } }]))),
          ...(Object.fromEntries(Object.entries(tProps).filter(([, p]: any) => p?.type === "checkbox").slice(0, 1).map(([k]) => [k, { checkbox: false }]))),
        },
      });

      await notion.pages.update({
        page_id: (r as any).id,
        properties: { "Task Page ID": { rich_text: [{ type: "text", text: { content: createdPage.id } }] } },
      });

      created++;
      details.push({ title, from: taskId, to: createdPage.id, next: nextISO });
    }

    return noStoreJson({ ok: true, processed, created, details });
  } catch (e: any) {
    return noStoreJson({ ok: false, error: e?.message || "worker failed", processed, created, details }, 500);
  }
}
