"use client";
import React, { useEffect, useRef, useState } from "react";

type HelpTipProps = {
  content: React.ReactNode;
  title?: string;
  side?: "right" | "left" | "top" | "bottom";
};

export default function HelpTip({ content, title = "Help", side = "right" }: HelpTipProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / ESC
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // Positioning
  const pos: React.CSSProperties = { position: "absolute", zIndex: 9999, maxWidth: 280 };
  if (side === "right")  { pos.left = "calc(100% + 8px)"; pos.top = 0; }
  if (side === "left")   { pos.right = "calc(100% + 8px)"; pos.top = 0; }
  if (side === "top")    { pos.left = "50%"; pos.transform = "translateX(-50%)"; pos.bottom = "calc(100% + 8px)"; }
  if (side === "bottom") { pos.left = "50%"; pos.transform = "translateX(-50%)"; pos.top = "calc(100% + 8px)"; }

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={title}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{
          width: 20, height: 20, lineHeight: "20px", textAlign: "center",
          border: "1px solid #111", borderRadius: 999, background: "#fff", cursor: "help",
          fontSize: 12, padding: 0, marginLeft: 6
        }}
      >
        ?
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={title}
          style={{
            ...pos,
            background: "#fff",
            border: "1px solid #111",
            boxShadow: "0 4px 16px rgba(0,0,0,.12)",
            padding: "10px 12px",
            borderRadius: 6,
            fontSize: 12,
            color: "#111",
            pointerEvents: "auto",
            // prevent clipping in containers
            overflow: "visible",
          }}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          {content}
        </div>
      )}
    </div>
  );
}
