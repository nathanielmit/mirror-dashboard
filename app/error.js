"use client";
import { useEffect } from "react";

// If the dashboard throws while rendering, don't sit on a white screen —
// auto-reload after a short pause. (Supervisor would also catch it via the
// stale heartbeat, but this recovers faster and in-process.)
export default function Error({ reset }) {
  useEffect(() => {
    const t = setTimeout(() => window.location.reload(), 5000);
    return () => clearTimeout(t);
  }, []);
  return (
    <main className="wrap" style={{ alignItems: "center", justifyContent: "center" }}>
      <div className="vtext">reloading…</div>
    </main>
  );
}
