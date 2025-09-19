// app/api/oauth/done/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const handoff = u.searchParams.get("h") || "";

  const html = `<!doctype html>
<meta charset="utf-8">
<title>Connecting…</title>
<script>
(async function () {
  var h = ${JSON.stringify(handoff)};
  var sid = null;
  try {
    // Create/attach a server session for this handoff
    var r = await fetch("/api/session/adopt?h=" + encodeURIComponent(h), {
      method: "POST",
      credentials: "include",
      cache: "no-store"
    });
    var j = await r.json().catch(function(){ return {}; });
    sid = j && j.sid ? j.sid : null;
  } catch (e) {}

  // Notify opener (iframe) and parent (for good measure)
  try { if (window.opener) window.opener.postMessage({ type: "recurio:oauth-complete", handoff: h, sid: sid }, "*"); } catch (e) {}
  try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: "recurio:oauth-complete", handoff: h, sid: sid }, "*"); } catch (e) {}

  // Close popup
  setTimeout(function(){ try { window.close(); } catch(e) {} }, 250);
})();
</script>
<body style="font:14px system-ui;padding:16px">Connecting your Notion… You can close this window.</body>`;

  return new NextResponse(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
