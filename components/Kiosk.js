"use client";
import { useEffect } from "react";

// Invisible kiosk-health component:
//  - heartbeat: tells the server the page is alive (supervisor watches this)
//  - daily refresh: reloads once in the early morning to clear browser cruft
const REFRESH_HOUR = 4; // 4am local

export default function Kiosk() {
  useEffect(() => {
    const ping = () => fetch("/api/health", { method: "POST" }).catch(() => {});
    ping();
    const hb = setInterval(ping, 10000);

    let refreshed = false;
    const clock = setInterval(() => {
      const n = new Date();
      if (n.getHours() === REFRESH_HOUR && n.getMinutes() === 0 && !refreshed) {
        refreshed = true; // guard against firing twice within the minute
        window.location.reload();
      }
      if (n.getHours() !== REFRESH_HOUR) refreshed = false;
    }, 20000);

    return () => { clearInterval(hb); clearInterval(clock); };
  }, []);

  return null;
}
