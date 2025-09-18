import { NextResponse } from "next/server";
import { cookies as getCookies } from "next/headers";
import { Client } from "@notionhq/client";
import { redisGet, redisSet } from "../../_utils";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code || !state) {
    return new NextResponse("Bad OAuth state", { status: 400 });
  }

  // Look up sid we saved at /oauth/start
  const oauthRec = await redisGet<{ sid: string }>(`oauth:${state}`);
  const sid = oauthRec?.sid;
  if (!sid) {
    return new NextResponse("Bad OAuth state", { status: 400 });
  }

  // Exchange code for token
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

  // Persist tokens
  await redisSet(`tok:${sid}`, tok);
  await redisSet("tok:latest", tok); // used by worker/iframe

  // Ensure browser has sid for subsequent UI calls
  const res = new NextResponse(
    `<!doctype html><title>Connected</title>
     <script>
       if (window.opener) { window.opener.location = '/'; window.close(); }
       else { location = '/'; }
     </script>`,
    { headers: { "Content-Type": "text/html" } }
  );

  res.cookies.set({
    name: "sid",
    value: sid,
    httpOnly: true,
    sameSite: "lax",
    path: "/"
  });

  // (Optional) create the panel page
  try {
    const notion = new Client({ auth: (tok as any).access_token });
    await notion.pages.create({
      parent: { type: "workspace", workspace: true } as any,
      icon: { type: "emoji", emoji: "🔁" },
      properties: {
        title: { title: [{ text: { content: "Techwisely Recurrence Panel" } }] },
      },
      children: [
        { object: "block", type: "embed", embed: { url: `${process.env.APP_URL}` } },
      ],
    } as any);
  } catch { /* ignore */ }

  return res;
}
