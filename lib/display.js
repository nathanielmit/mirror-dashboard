// Presence-aware panel sleep.
//
// The pixel face already computes a motion centroid from the camera every
// 120ms; the browser forwards that here, and after a quiet spell the panel is
// put to sleep with DPMS. Someone walking back in wakes it.
//
// Automatic DPMS timeouts are pinned to zero and blanking is driven explicitly
// instead. X's own idle timer counts *input* — keyboard and mouse — and a
// mirror has neither, so it would blank the display while somebody stood in
// front of it reading.
import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import path from "path";

const execFileP = promisify(execFile);

const IDLE_MS = Number(process.env.MIRROR_SLEEP_MINUTES || 10) * 60 * 1000;
const CHECK_MS = 20 * 1000;
const ENABLED = process.env.MIRROR_SLEEP !== "0";

const XENV = {
  ...process.env,
  DISPLAY: process.env.MIRROR_DISPLAY || ":0",
  XAUTHORITY: process.env.XAUTHORITY || path.join(os.homedir(), ".Xauthority"),
};

let state = {
  awake: true,
  lastMotion: Date.now(),
  lastChange: 0,
  sleeps: 0,
  wakes: 0,
  ready: false,
};

async function xset(args) {
  try {
    await execFileP("xset", args, { env: XENV, timeout: 5000 });
    return true;
  } catch {
    return false;   // no X session (dev machine, or server started before X)
  }
}

// Enable DPMS but with every automatic timeout at zero, so nothing blanks
// except when we say so. Idempotent; re-run costs nothing.
async function prepare() {
  if (state.ready) return;
  state.ready = true;
  await xset(["+dpms"]);
  await xset(["dpms", "0", "0", "0"]);
  await xset(["s", "off"]);
  await xset(["s", "noblank"]);
}

export async function wake() {
  await prepare();
  if (state.awake) return false;
  const ok = await xset(["dpms", "force", "on"]);
  if (ok) { state.awake = true; state.lastChange = Date.now(); state.wakes++; }
  return ok;
}

export async function sleepPanel() {
  await prepare();
  if (!state.awake) return false;
  const ok = await xset(["dpms", "force", "off"]);
  if (ok) { state.awake = false; state.lastChange = Date.now(); state.sleeps++; }
  return ok;
}

// Called by the browser. `motion` true means someone moved in front of it.
export async function notePresence(motion) {
  await prepare();
  if (motion) {
    state.lastMotion = Date.now();
    if (!state.awake) await wake();
  }
  return status();
}

export function status() {
  return {
    ...state,
    idleMs: Date.now() - state.lastMotion,
    idleLimitMs: IDLE_MS,
    enabled: ENABLED,
  };
}

// One timer for the process. Node keeps this alive for the server's lifetime,
// which is what we want: the panel must still fall asleep if the browser stops
// reporting entirely (crashed renderer, page closed).
if (ENABLED && !globalThis.__mirrorSleepTimer) {
  globalThis.__mirrorSleepTimer = setInterval(() => {
    if (state.awake && Date.now() - state.lastMotion > IDLE_MS) {
      sleepPanel().catch(() => {});
    }
  }, CHECK_MS);
}
