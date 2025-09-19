// app/api/_props.ts
/* Utilities to robustly read Title, Due date, and Done across many schema styles */

function norm(s: any): string {
  return String(s || "").toLowerCase().trim();
}

/** Pull the page title from whichever property is 'title'. */
export function extractTitle(props: any): string {
  for (const k of Object.keys(props || {})) {
    const p = props[k];
    if (p?.type === "title") {
      const arr = p?.title || [];
      return arr.map((t: any) => t?.plain_text || t?.text?.content || "").join("").trim() || "Untitled";
    }
  }
  return "Untitled";
}

/** Prefer a property named like Due/Deadline/Date/When/Scheduled; else the first date; else a formula(date) */
export function extractDueISO(props: any): string | null {
  const prefer = ["due", "deadline", "date", "when", "start", "scheduled", "starts"];
  const keys = Object.keys(props || {});
  const dateKeys = keys.filter(k => props[k]?.type === "date");
  if (dateKeys.length) {
    let use: string | null = null;
    const lowered = dateKeys.map(k => [k, norm(k)] as [string, string]);
    for (const p of prefer) {
      const hit = lowered.find(([, n]) => n.includes(p));
      if (hit) { use = hit[0]; break; }
    }
    if (!use) use = dateKeys[0];
    const v = props[use!]?.date;
    return v?.end || v?.start || null;
  }
  // formula(date)
  for (const k of keys) {
    const p = props[k];
    if (p?.type === "formula" && p?.formula?.type === "date") {
      const v = p.formula.date;
      if (v?.end || v?.start) return v.end || v.start;
    }
  }
  return null;
}

/** Detect “done” via: checkbox(true), status('done' etc), select/multi_select('done' etc), or formula(checkbox=true). */
export function isTaskDone(props: any): boolean {
  const doneWords = ["done", "complete", "completed", "finished", "resolved", "closed", "✅", "✔"];

  // 1) strong signal: a checkbox named like “Done/Complete” and true
  for (const k of Object.keys(props || {})) {
    const p = props[k];
    if (p?.type === "checkbox") {
      if (p.checkbox && (norm(k).includes("done") || norm(k).includes("complete"))) {
        return true;
      }
    }
  }

  // 2) any true checkbox
  for (const k of Object.keys(props || {})) {
    const p = props[k];
    if (p?.type === "checkbox" && p.checkbox) return true;
  }

  // 3) Status value name
  for (const k of Object.keys(props || {})) {
    const p = props[k];
    if (p?.type === "status") {
      const name = norm(p?.status?.name || "");
      if (name && doneWords.some(w => name.includes(w))) return true;
    }
  }

  // 4) Select / Multi-select value(s)
  for (const k of Object.keys(props || {})) {
    const p = props[k];
    if (p?.type === "select") {
      const name = norm(p?.select?.name || "");
      if (name && doneWords.some(w => name.includes(w))) return true;
    }
    if (p?.type === "multi_select") {
      const names = (p?.multi_select || []).map((o: any) => norm(o?.name || ""));
      if (names.some(n => doneWords.some(w => n.includes(w)))) return true;
    }
  }

  // 5) formula(checkbox)
  for (const k of Object.keys(props || {})) {
    const p = props[k];
    if (p?.type === "formula" && p?.formula?.type === "checkbox" && p?.formula?.checkbox) {
      return true;
    }
  }

  return false;
}
