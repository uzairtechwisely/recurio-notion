// app/api/oauth/callback/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { NextResponse } from "next/server";
import { cookies as getCookies } from "next/headers";
import { noStoreJson } from "../../_http";
import { exchangeCodeForToken, redisSet, notionClient, ensureManagedContainers } from "../../_utils";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const origin = u.origin;
  const code = u.searchParams.get("code");
  const inboundState = u.searchParams.get("state");

  const jar = await getCookies();
  const stateCookie = jar.get("oauth_state")?.value || null;
  const sid = jar.get("sid")?.value || null;

  if (!code) return noStoreJson({ ok: false, error: "missing_code" }, 400);

  try {
    // 1) Exchange code → token
    const tok = await exchangeCodeForToken(code, `${origin}/api/oauth/callback`);

    // 2) If state & sid match, bind token to this SID (nice-to-have)
    if (inboundState && stateCookie && inboundState === stateCookie && sid) {
      try {
        await redisSet(`tok:${sid}`, tok);
        await redisSet("tok:latest", tok); // keep compatibility (behind env flag in readers)
      } catch {}
    }

    // 3) Create stable connection id for this workspace
    const cid = String(tok.workspace_id || tok.owner?.workspace?.id || tok.bot_id || crypto.randomUUID());
    await redisSet(`conn:${cid}`, tok);

    // 4) Ensure managed containers and update the panel embed to include ?c=<cid>
    try {
      const notion = notionClient(tok.access_token);
      const wsId = String(tok.workspace_id || "");
      const { pageId, dbId, panelId } = await ensureManagedContainers(notion, wsId);

      const appUrl = process.env.APP_URL || origin;
      const embedUrl = `${appUrl}?c=${encodeURIComponent(cid)}`;

      if (panelId) {
        try {
          const kids: any = await notion.blocks.children.list({ block_id: panelId as string, page_size: 50 });
          const emb = (kids.results || []).find((b: any) => b.type === "embed");
          if (emb?.id) {
            await notion.blocks.update({ block_id: emb.id, embed: { url: embedUrl } } as any);
          } else {
            await notion.blocks.children.append({
              block_id: panelId as string,
              children: [{ object: "block", type: "embed", embed: { url: embedUrl } }],
            } as any);
          }
        } catch {}
      }
    } catch {}

    // 5) Handoff for popup/parent to adopt and close
    const handoff = crypto.randomUUID();
    await redisSet(`handoff:${handoff}`, tok);

    return NextResponse.redirect(
      `${origin}/api/oauth/done?h=${encodeURIComponent(handoff)}`,
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return noStoreJson({ ok: false, error: "oauth_callback_failed", detail: e?.message || String(e) }, 500);
  }
}