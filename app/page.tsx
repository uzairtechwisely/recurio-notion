"use client";
import { useEffect, useState } from "react";

export default function Home() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    fetch("/api/me").then(r => r.json()).then(d => setConnected(!!d.connected));
  }, []);

  const connect = () => {
    window.open("/api/oauth/start", "notionAuth", "width=480,height=720");
    const t = setInterval(async () => {
      const d = await (await fetch("/api/me")).json();
      if (d.connected) { clearInterval(t); location.reload(); }
    }, 1500);
  };

  return (
    <main className="container">
      <h1>Recurio — barebones</h1>
      {!connected ? (
        <div className="card">
          <p>Connect your Notion workspace to continue.</p>
          <button onClick={connect}>Connect Notion</button>
        </div>
      ) : (
        <div className="card">
          <p>✅ Connected to Notion.</p>
          <p>Check your Notion sidebar for <b>“Techwisely Recurrence Panel”</b> (auto-created).</p>
        </div>
      )}
      <div className="card">
        <a href="/api/oauth/start" target="_blank" rel="noreferrer">Open OAuth in new tab</a>
      </div>
    </main>
  );
}
