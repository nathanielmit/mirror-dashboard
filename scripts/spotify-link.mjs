#!/usr/bin/env node
// Link Spotify from an SSH session, where no browser can reach the mirror.
//
// The normal flow assumes you can open http://127.0.0.1:3000/... on the box
// itself. Over SSH you can't, so this splits the flow in two: authorize in a
// browser anywhere, then hand the resulting code back over the terminal.
//
//   node scripts/spotify-link.mjs                 # prints the URL to visit
//   node scripts/spotify-link.mjs '<code|url>'    # completes the link
//
// After approving, the browser lands on a 127.0.0.1 address that won't load —
// that failure is expected and harmless. The code is in the address bar; paste
// the whole URL (quoted) or just the code value.
import fs from "fs";
import os from "os";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");
const STATE_DIR = path.join(os.homedir(), ".local/share/mirror-dashboard");
const TOKEN_FILE = path.join(STATE_DIR, "spotify.json");
const REDIRECT_URI = "http://127.0.0.1:3000/api/spotify/callback";
const SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "playlist-read-private",
  "playlist-read-collaborative",
].join(" ");

// Minimal .env.local reader — this runs outside Next, so nothing loads it for us.
function env() {
  const out = {};
  try {
    for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
  return { ...out, ...process.env };
}

const { SPOTIFY_CLIENT_ID: ID, SPOTIFY_CLIENT_SECRET: SECRET } = env();
if (!ID || !SECRET) {
  console.error("SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET missing from .env.local");
  process.exit(1);
}

const arg = process.argv[2];

if (!arg) {
  const url = new URL("https://accounts.spotify.com/authorize");
  url.searchParams.set("client_id", ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("show_dialog", "true");
  console.log("\n1. Open this in a browser on any machine:\n");
  console.log(url.toString());
  console.log("\n2. Approve. The browser will fail to load a 127.0.0.1 page — that's expected.");
  console.log("3. Copy the address it tried to load, and run:\n");
  console.log("   node scripts/spotify-link.mjs '<paste the whole URL here>'\n");
  process.exit(0);
}

// Accept either the full redirect URL or a bare code.
let code = arg.trim();
if (code.includes("code=")) {
  try { code = new URL(code).searchParams.get("code"); }
  catch { code = (code.match(/code=([^&\s]+)/) || [])[1]; }
}
if (!code) {
  console.error("Couldn't find a code in that. Paste the full redirect URL, quoted.");
  process.exit(1);
}

const body = new URLSearchParams({
  grant_type: "authorization_code",
  code,
  redirect_uri: REDIRECT_URI,
});

const r = await fetch("https://accounts.spotify.com/api/token", {
  method: "POST",
  headers: {
    Authorization: "Basic " + Buffer.from(`${ID}:${SECRET}`).toString("base64"),
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body,
});

const data = await r.json().catch(() => ({}));
if (!r.ok || !data.refresh_token) {
  console.error(`\nFailed (${r.status}):`, JSON.stringify(data));
  if (data.error === "invalid_grant") {
    console.error("\nAuthorization codes are single-use and expire within a minute.");
    console.error("Run this with no arguments to get a fresh URL and try again.");
  }
  process.exit(1);
}

fs.mkdirSync(STATE_DIR, { recursive: true });
fs.writeFileSync(TOKEN_FILE, JSON.stringify({ ...data, obtained_at: Date.now() }, null, 2), { mode: 0o600 });
console.log("\nLinked. Tokens saved to", TOKEN_FILE);
console.log('Now say: "hey mirror, play some lofi on spotify"\n');
