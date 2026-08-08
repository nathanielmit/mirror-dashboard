"use client";
import { useEffect, useRef } from "react";
import { getCameraStream } from "../lib/camera";
import { STALE_MS } from "../lib/liveness";

// A pixel face whose eyes follow whoever walks past.
//
// Tracking is frame-differencing on a tiny 64x48 copy of the camera feed —
// the centroid of whatever moved. No ML model, no library, no download, and it
// costs almost nothing, which matters on a box already running Whisper. It
// tracks *movement* rather than faces, which is exactly right here: someone
// walking by is the thing we want the eyes to catch.
//
//   press "f" — hide the face
const COLS = 18, ROWS = 9;          // face grid
const CELL = 14, GAP = 2;           // pixel size on screen
const EYE_W = 7, EYE_H = 5, EYE_GAP = 4;

const MW = 64, MH = 48;             // motion-detection resolution
const DIFF_MIN = 18;                // per-pixel change that counts as movement
const MOTION_MIN = 900;             // total change below this is just sensor noise
const SAMPLE_MS = 120;
const IDLE_AFTER_MS = 4000;         // no movement for this long -> drift/idle
const PRESENCE_MS = 5000;           // how often we report presence to the server
const STATE_MS = 800;               // how often we poll what the voice daemon is doing

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export default function Face() {
  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const state = useRef({
    gx: 0, gy: 0,        // where the eyes are actually looking (-1..1)
    tx: 0, ty: 0,        // where they want to look
    lastMotion: 0,
    blinkUntil: 0,
    nextBlink: 0,
    on: true,
    sawMotion: false,    // motion since the last presence report
    cameraOk: false,     // false = can't judge presence, so never sleep the panel
    expr: "idle",        // idle | thinking | speaking | down
  });

  // What the voice daemon is doing, so the face can show it: narrowed eyes
  // while it thinks, a moving mouth while it speaks, shut eyes if it's dead.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/voice/state", { cache: "no-store" }).then(x => x.json());
        if (!alive) return;
        const stale = r.ageMs === null || r.ageMs > STALE_MS;
        state.current.expr = stale ? "down"
          : r.status === "thinking" ? "thinking"
          : r.status === "speaking" ? "speaking"
          : "idle";
      } catch {
        if (alive) state.current.expr = "down";
      }
    };
    poll();
    const t = setInterval(poll, STATE_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Tell the server whether anyone is about, so it can sleep the panel.
  // Reported on a steady interval rather than per-detection: it doubles as a
  // liveness signal, so a dead page lets the panel fall asleep on its own.
  useEffect(() => {
    const send = () => {
      // If the camera never came up we can't know whether anyone is there, so
      // report presence unconditionally. A broken camera must not leave the
      // mirror asleep forever with no way to wake it.
      const motion = state.current.cameraOk ? state.current.sawMotion : true;
      state.current.sawMotion = false;
      fetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motion }),
      }).catch(() => {});
    };
    const t = setInterval(send, PRESENCE_MS);
    return () => clearInterval(t);
  }, []);

  // --- camera + motion ----------------------------------------------------
  useEffect(() => {
    let alive = true, timer = 0;
    const video = document.createElement("video");
    video.muted = true; video.playsInline = true;
    videoRef.current = video;

    const mc = document.createElement("canvas");
    mc.width = MW; mc.height = MH;
    const mctx = mc.getContext("2d", { willReadFrequently: true });
    let prev = null;

    const sample = () => {
      if (!alive || video.readyState < 2) return;
      mctx.drawImage(video, 0, 0, MW, MH);
      const px = mctx.getImageData(0, 0, MW, MH).data;
      const gray = new Uint8Array(MW * MH);
      for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
        gray[i] = (px[p] + px[p + 1] + px[p + 2]) / 3;
      }
      if (prev) {
        let sum = 0, sx = 0, sy = 0;
        for (let y = 0; y < MH; y++) {
          for (let x = 0; x < MW; x++) {
            const i = y * MW + x;
            const d = Math.abs(gray[i] - prev[i]);
            if (d > DIFF_MIN) { sum += d; sx += x * d; sy += y * d; }
          }
        }
        if (sum > MOTION_MIN) {
          const s = state.current;
          // Flip X: the camera looks out at the room, so its image is mirrored
          // relative to the viewer — same reason the preview is flipped.
          s.tx = clamp(-((sx / sum) / MW * 2 - 1), -1, 1);
          s.ty = clamp((sy / sum) / MH * 2 - 1, -1, 1);
          s.lastMotion = performance.now();
          s.sawMotion = true;   // latched until the next presence report
        }
      }
      prev = gray;
    };

    getCameraStream().then(stream => {
      if (!alive) return;
      state.current.cameraOk = true;
      video.srcObject = stream;
      video.play().catch(() => {});
      timer = setInterval(sample, SAMPLE_MS);
    }).catch(() => { /* no camera: the face just idles */ });

    return () => { alive = false; clearInterval(timer); video.srcObject = null; };
  }, []);

  // --- drawing ------------------------------------------------------------
  useEffect(() => {
    let raf = 0;
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const fg = getComputedStyle(document.documentElement).getPropertyValue("--fg").trim() || "#e8e8ea";

    const cell = (x, y, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(x * (CELL + GAP), y * (CELL + GAP), CELL, CELL);
    };

    const drawEye = (ox, gx, gy, blinking, expr) => {
      // Closed eye: one bar. Used for blinks and for "the daemon is dead".
      if (blinking || expr === "down") {
        for (let x = 0; x < EYE_W; x++) cell(ox + x, 2, fg);
        return;
      }
      // Thinking narrows the eye to the middle three rows — a squint.
      const y0 = expr === "thinking" ? 1 : 0;
      const y1 = expr === "thinking" ? EYE_H - 1 : EYE_H;
      for (let y = y0; y < y1; y++) {
        for (let x = 0; x < EYE_W; x++) {
          // knock the corners off so the eye reads as rounded, not a box
          const corner = (x === 0 || x === EYE_W - 1) && (y === 0 || y === EYE_H - 1);
          if (!corner) cell(ox + x, y, fg);
        }
      }
      const px = 1 + Math.round(((gx + 1) / 2) * 3);   // 1..4
      // While thinking the pupils drift up, the way people look up to recall.
      const py = expr === "thinking" ? 1 : 1 + (gy > 0.33 ? 1 : 0);
      const ph = expr === "thinking" ? 1 : 2;          // squint leaves less room
      ctx.clearRect(
        (ox + px) * (CELL + GAP) - GAP / 2, py * (CELL + GAP) - GAP / 2,
        2 * (CELL + GAP), ph * (CELL + GAP)
      );
    };

    // Flat line at rest; while speaking it opens and closes so the face looks
    // like it's saying the words you're hearing.
    const drawMouth = (expr, now) => {
      const dim = "#5a5a64";
      if (expr === "speaking") {
        const open = Math.sin(now / 90) > 0;   // ~5 flaps a second
        if (open) {
          for (let x = 7; x < 11; x++) { cell(x, 6, fg); cell(x, 7, fg); }
          cell(6, 6, fg); cell(11, 6, fg);
          return;
        }
      }
      for (let x = 6; x < 12; x++) cell(x, 7, dim);
      cell(5, 6, dim);
      cell(12, 6, dim);
    };

    const frame = () => {
      const s = state.current;
      const now = performance.now();

      if (now - s.lastMotion > IDLE_AFTER_MS) {
        // Nobody about: drift slowly rather than staring dead ahead.
        s.tx = Math.sin(now / 3200) * 0.55;
        s.ty = 0;
      }
      // Ease toward the target so the eyes glide instead of snapping.
      s.gx += (s.tx - s.gx) * 0.12;
      s.gy += (s.ty - s.gy) * 0.12;

      if (now > s.nextBlink) {
        s.blinkUntil = now + 130;
        s.nextBlink = now + 2600 + Math.random() * 4200;
      }
      // Don't blink mid-sentence, and don't blink a face whose eyes are
      // already shut because the daemon is down.
      const blinking = now < s.blinkUntil && s.expr === "idle";

      ctx.clearRect(0, 0, cv.width, cv.height);
      drawEye(0, s.gx, s.gy, blinking, s.expr);
      drawEye(EYE_W + EYE_GAP, s.gx, s.gy, blinking, s.expr);
      drawMouth(s.expr, now);

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const key = (e) => {
      if (e.key === "f" || e.key === "F") {
        const el = canvasRef.current;
        if (el) el.style.display = el.style.display === "none" ? "" : "none";
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="face"
      width={COLS * (CELL + GAP)}
      height={ROWS * (CELL + GAP)}
    />
  );
}
