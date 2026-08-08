"use client";
import { useEffect } from "react";

// Last-resort boundary: catches errors in the root layout itself. Must render
// its own <html>/<body>. Auto-reloads so the glass never stays blank.
export default function GlobalError() {
  useEffect(() => {
    const t = setTimeout(() => window.location.reload(), 5000);
    return () => clearTimeout(t);
  }, []);
  return (
    <html lang="en">
      <body style={{ background: "#000", color: "#7d7d86", height: "100vh", margin: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "system-ui, sans-serif", fontWeight: 300 }}>
        reloading…
      </body>
    </html>
  );
}
