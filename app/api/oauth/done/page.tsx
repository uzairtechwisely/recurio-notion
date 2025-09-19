// app/oauth/done/page.tsx
"use client";

import { useEffect } from "react";

export default function OAuthDone() {
  useEffect(() => {
    try {
      const msg = { type: "recurio:oauth-complete" };
      // Notify both popup opener and embedding parent (Notion iframe)
      window.opener?.postMessage(msg, "*");
      window.parent?.postMessage(msg, "*");
    } catch {}
    // try close (may be blocked for tabs)
    try { window.close(); } catch {}
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: "ui-sans-serif, system-ui" }}>
      <h3>Connected ✓</h3>
      <p>You can close this window.</p>
    </main>
  );
}
