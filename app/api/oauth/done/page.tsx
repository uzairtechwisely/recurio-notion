// app/oauth/done/page.tsx
"use client";
import { useEffect } from "react";

export default function OAuthDone() {
  useEffect(() => {
    try {
      const h = new URL(window.location.href).searchParams.get("h");
      const msg = { type: "recurio:oauth-complete", handoff: h };
      // Notify popup opener and embedding parent (Notion iframe)
      window.opener?.postMessage(msg, "*");
      window.parent?.postMessage(msg, "*");
    } catch {}
    try { window.close(); } catch {}
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: "ui-sans-serif, system-ui" }}>
      <h3>Connected ✓</h3>
      <p>You can close this window.</p>
    </main>
  );
}
