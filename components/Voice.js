"use client";
import { useEffect, useState } from "react";
import { STALE_MS } from "../lib/liveness";

// Display for the local voice daemon (scripts/listen.py). Recognition and
// speech both happen on the machine now — the Web Speech API is unusable here
// because Google restricts that backend to official Chrome builds, and the
// Chromium snap gets a bare "network" error. So this component no longer
// listens or talks; it polls the daemon's state and shows it.
//
//   press "d" — hide the bottom-left readout
const POLL_MS = 700;

export default function Voice() {
  const [s, setS] = useState(null);
  const [reachable, setReachable] = useState(true);
  const [debug, setDebug] = useState(true);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/voice/state", { cache: "no-store" }).then(x => x.json());
        if (!alive) return;
        setS(r); setReachable(true);
      } catch (e) {
        if (alive) setReachable(false);
      }
    };
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    const key = (e) => { if (e.key === "d" || e.key === "D") setDebug(v => !v); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const down = !reachable || !s || s.ageMs === null || s.ageMs > STALE_MS;
  const status = down
    ? "voice daemon not running"
    : s.status === "thinking" ? "thinking…"
    : s.status === "speaking" ? (s.reply || "speaking…")
    : 'say “hey mirror …”';

  return (
    <>
      {/* Just the last thing understood, tucked into the bottom-left corner
          below the animation zone. No history, no counters. */}
      {debug && s?.heard && <div className="heard">{s.heard}</div>}
      <div className="voice">
        <div className={"vdot " + (down ? "" : s.status === "speaking" || s.status === "thinking" ? "active" : "listening")} />
        <div className="vtext">{status}</div>
      </div>
    </>
  );
}
