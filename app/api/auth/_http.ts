export function noStoreJson(data: any, status = 200, extra?: HeadersInit) {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json");
  headers.set("cache-control", "no-store, must-revalidate");
  // allow embedding in Notion
  headers.set(
    "content-security-policy",
    "frame-ancestors 'self' https://www.notion.so https://*.notion.so https://*.notion.site"
  );
  return new Response(JSON.stringify(data), { status, headers });
}
