import { NextResponse } from "next/server";
import { cookies as getCookies } from "next/headers";
import { Client } from "@notionhq/client";
import { redisSet } from "../../_utils";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  const store = await getCookies();
  const oldState = store.get("oauth_state")?.value;
  const sid = store.get("sid")?.value;

  if (!code || !state || state !== oldState || !sid) {
    return new NextResponse("Bad OAuth state", { status: 400 });
  }

  const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization":
        "Basic " +
        Buffer.from(
          `${process.env.NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`
        ).toString("base64"),
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${process.env.APP_URL}/api/oauth/callback`,
    }),
  });

  const tok = await tokenRes.json();
  if (!(tok as any)?.access_token) {
    return new NextResponse("OAuth failed", { status: 400 });
  }

  await redisSet(`tok:${sid}`, tok);

  // Optional: create the sidebar panel page with an embed
  try {
    const notion = new Client({ auth: (tok as any).access_token });
    await notion.pages.create({
      // Cast to any because Notion SDK types don't include the "workspace" parent shape
      parent: { type: "workspace", workspace: true } as any,
      icon: { type: "emoji", emoji: "🔁" },
      properties: {
        title: { title: [{ text: { content: "Techwisely Recurrence Panel" } }] },
      },
      children: [
        { object: "block", type: "embed", embed: { url: `${process.env.APP_URL}` } },
      ],
    } as any);
  } catch {
    // ignore page-creation errors for now
  }

  const html = `<!doctype html><title>Connected</title>
  <script>
    if (window.opener) { window.opener.location = '/'; window.close(); }
    else { location = '/'; }
  </script>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html" } });
}
