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
(function () {
  var h = ${JSON.stringify(handoff)};
  try { if (window.opener) window.opener.postMessage({ type: "recurio:oauth-complete", handoff: h }, "*"); } catch (e) {}
  try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: "recurio:oauth-complete", handoff: h }, "*"); } catch (e) {}
  setTimeout(function () {
    try { window.close(); } catch (e) {}
    try { window.location.replace("about:blank"); } catch (e) {}
  }, 300);
})();
</script>
<body style="font:14px system-ui;padding:16px">Connected. You can close this window.</body>`;

  return new NextResponse(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
