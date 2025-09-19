// app/api/oauth/done/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const handoff = u.searchParams.get("h") || "";
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors *;"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Recurio Connected</title>
  <style>
    body{font:14px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Inter,system-ui,sans-serif;padding:24px}
    .btn{display:inline-block;margin-top:12px;padding:8px 12px;border:1px solid #111;text-decoration:none;color:#111}
  </style>
</head>
<body>
  <h3>Recurio connected ✓</h3>
  <p>You can close this window.</p>
  <a class="btn" id="back" href="/?handoff=${encodeURIComponent(handoff)}">Return to Recurio</a>
  <script>
    (function(){
      try {
        var msg = { type: "recurio:oauth-complete", handoff: ${JSON.stringify(handoff)} };
        // Notify popup opener (our dashboard inside Notion iframe) and embedding parent (Notion)
        window.opener && window.opener.postMessage(msg, "*");
        window.parent && window.parent.postMessage(msg, "*");
      } catch (e) {}
      // Attempt to close; the "Return to Recurio" link is a fallback
      setTimeout(function(){ try{ window.close(); }catch(e){} }, 50);
    })();
  </script>
</body>
</html>`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
