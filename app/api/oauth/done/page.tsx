"use client";
import * as React from "react";

export default function OAuthDone() {
  React.useEffect(() => {
    try {
      const u = new URL(window.location.href);
      const handoff = u.searchParams.get("h") || "";
      const payload = { type: "RECURIO_OAUTH", handoff };

      // Tell opener (popup flow) and parent (iframe flow)
      try { window.opener?.postMessage(payload, "*"); } catch {}
      try { window.parent?.postMessage(payload, "*"); } catch {}

      // Close if we're a popup; otherwise just show a short message
      setTimeout(() => {
        try { window.close(); } catch {}
      }, 250);
    } catch {}
  }, []);

  return (
    <div style={{fontFamily:"ui-sans-serif,system-ui",padding:24}}>
      <b>Connecting…</b>
      <div>This window will close automatically.</div>
    </div>
  );
}
