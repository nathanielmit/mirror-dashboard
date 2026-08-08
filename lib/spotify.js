// Spotify: find a playlist and start it shuffled on the mirror's own speakers.
//
// Auth is a one-time browser round trip (see /api/spotify/auth); after that we
// hold a refresh token and mint access tokens as needed. Tokens live OUTSIDE
// the repo so a stray `git add` can't publish them.
//
// Playback control requires Spotify Premium — the API answers 403 on free
// accounts no matter how the request is shaped.
import fs from "fs";
import os from "os";
import path from "path";

const STATE_DIR = path.join(os.homedir(), ".local/share/mirror-dashboard");
const TOKEN_FILE = path.join(STATE_DIR, "spotify.json");

// Spotify no longer accepts http://localhost as a redirect target; the literal
// loopback IP is the one plain-HTTP form still permitted.
export const REDIRECT_URI =
  process.env.SPOTIFY_REDIRECT_URI || "http://127.0.0.1:3000/api/spotify/callback";

export const SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "playlist-read-private",
  "playlist-read-collaborative",
].join(" ");

// Which Connect device to drive. librespot advertises itself under this name.
const DEVICE_NAME = process.env.MIRROR_SPOTIFY_DEVICE || "Mirror";

export function spotifyConfigured() {
  return Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
}

function readTokens() {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8")); } catch { return null; }
}

export function saveTokens(t) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2), { mode: 0o600 });
}

export function spotifyLinked() {
  return Boolean(readTokens()?.refresh_token);
}

function basicAuth() {
  return Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString("base64");
}

export async function exchangeCode(code) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
  });
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basicAuth()}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error(`token exchange failed: ${r.status} ${await r.text()}`);
  const t = await r.json();
  saveTokens({ ...t, obtained_at: Date.now() });
  return t;
}

// Access tokens last an hour; refresh a minute early rather than on failure.
async function accessToken() {
  const t = readTokens();
  if (!t?.refresh_token) return null;
  const age = Date.now() - (t.obtained_at || 0);
  if (t.access_token && age < ((t.expires_in || 3600) - 60) * 1000) return t.access_token;

  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basicAuth()}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token }),
  });
  if (!r.ok) return null;
  const fresh = await r.json();
  // A refresh response often omits refresh_token; keep the one we have.
  saveTokens({ ...t, ...fresh, refresh_token: fresh.refresh_token || t.refresh_token, obtained_at: Date.now() });
  return fresh.access_token;
}

async function api(pathname, { method = "GET", body } = {}) {
  const tok = await accessToken();
  if (!tok) return { ok: false, status: 401, data: null };
  const r = await fetch("https://api.spotify.com/v1" + pathname, {
    method,
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  if (r.status !== 204) { try { data = await r.json(); } catch {} }
  return { ok: r.ok, status: r.status, data };
}

// --- finding something to play -------------------------------------------

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// Match against the user's own playlists. Scored rather than exact-matched so
// "my anime playlist" finds a playlist actually called "Anime Bangers".
// Words that survive in a spoken query but say nothing about which playlist is
// meant. Scored low so "my anime playlist" is matched on "anime", and a
// playlist literally called "My Playlist" doesn't win on the filler alone.
const FILLER = new Set(["playlist", "playlists", "music", "song", "songs", "mix", "station", "radio"]);

export async function findOwnPlaylist(query) {
  const want = norm(query);
  if (!want) return null;
  const words = want.split(" ").filter(w => w.length > 2);
  const strong = words.filter(w => !FILLER.has(w));
  let best = null, bestScore = 0;

  for (let offset = 0; offset < 200; offset += 50) {
    const { ok, data } = await api(`/me/playlists?limit=50&offset=${offset}`);
    if (!ok || !data?.items?.length) break;
    for (const p of data.items) {
      if (!p?.uri) continue;
      const name = norm(p.name);
      let score = 0;
      if (name === want) score = 100;
      else if (name.includes(want)) score = 80;
      else {
        score = strong.filter(w => name.includes(w)).length * 20
              + words.filter(w => FILLER.has(w) && name.includes(w)).length * 3;
      }
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (data.items.length < 50) break;
  }
  // 20 = at least one meaningful word matched. Filler alone can't clear this.
  return bestScore >= 20 ? best : null;
}

export async function searchPlaylist(query) {
  const q = encodeURIComponent(query);
  const { ok, data } = await api(`/search?q=${q}&type=playlist&limit=10`);
  if (!ok) return null;
  // Spotify sometimes returns null entries in this array; filter before use.
  const items = (data?.playlists?.items || []).filter(Boolean);
  return items[0] || null;
}

// --- playback -------------------------------------------------------------

export async function listDevices() {
  const { ok, data } = await api("/me/player/devices");
  return ok ? (data?.devices || []) : [];
}

async function targetDevice() {
  const devices = await listDevices();
  if (!devices.length) return null;
  const want = DEVICE_NAME.toLowerCase();
  return devices.find(d => (d.name || "").toLowerCase() === want)
      || devices.find(d => (d.name || "").toLowerCase().includes(want))
      || devices.find(d => d.is_active)
      || devices[0];
}

/**
 * Start a playlist shuffled.
 *
 * Order matters: shuffle set before playback is frequently ignored, because
 * there's no context for it to apply to yet. Start the context, turn shuffle
 * on, then skip — the skip is what actually lands you on a random track rather
 * than always track 1.
 */
export async function playShuffled(contextUri) {
  const dev = await targetDevice();
  if (!dev) return { ok: false, reason: "no-device" };

  if (!dev.is_active) {
    await api("/me/player", { method: "PUT", body: { device_ids: [dev.id], play: false } });
    await new Promise(r => setTimeout(r, 400)); // let the transfer land
  }

  const play = await api(`/me/player/play?device_id=${dev.id}`, {
    method: "PUT",
    body: { context_uri: contextUri },
  });
  if (!play.ok) {
    if (play.status === 403) return { ok: false, reason: "premium-required", device: dev.name };
    if (play.status === 404) return { ok: false, reason: "no-device", device: dev.name };
    return { ok: false, reason: `http-${play.status}`, device: dev.name };
  }

  await api(`/me/player/shuffle?state=true&device_id=${dev.id}`, { method: "PUT" });
  await api(`/me/player/next?device_id=${dev.id}`, { method: "POST" });
  return { ok: true, device: dev.name };
}

/**
 * Resolve a spoken request to a playlist and play it.
 * `mine` prefers the user's own library; we still fall back to search so
 * "play my anime playlist" works even if they don't actually have one.
 */
export async function playRequest({ query, mine }) {
  if (!spotifyConfigured()) return { ok: false, reason: "not-configured" };
  if (!spotifyLinked()) return { ok: false, reason: "not-linked" };

  let pl = null, source = null;
  if (mine) {
    pl = await findOwnPlaylist(query);
    source = pl ? "yours" : null;
  }
  if (!pl) {
    pl = await searchPlaylist(query);
    source = pl ? "spotify" : null;
  }
  if (!pl) return { ok: false, reason: "not-found" };

  const res = await playShuffled(pl.uri);
  return { ...res, playlist: pl.name, source };
}

// --- ducking ---------------------------------------------------------------
// Volume is driven through Spotify rather than the local PipeWire stream.
// librespot's pw-play sits in a blocking read on the pipe whenever nothing is
// playing, so it can't service a control round trip — `wpctl set-volume` and
// `pactl set-sink-input-volume` both hang on that node, which would stall the
// voice daemon before every reply. The API path always answers.
let ducked = null;   // volume_percent to restore, or null when not ducked

export async function duck(on, factor = 0.25) {
  if (!spotifyConfigured() || !spotifyLinked()) return { ok: false, reason: "not-linked" };

  if (on) {
    if (ducked !== null) return { ok: true, already: true };
    const { ok, data } = await api("/me/player");
    const dev = ok ? data?.device : null;
    // Nothing playing, or a device with no volume control — nothing to do.
    if (!dev || typeof dev.volume_percent !== "number" || !data?.is_playing) {
      return { ok: false, reason: "not-playing" };
    }
    ducked = dev.volume_percent;
    const to = Math.max(1, Math.round(ducked * factor));
    await api(`/me/player/volume?volume_percent=${to}`, { method: "PUT" });
    return { ok: true, from: ducked, to };
  }

  if (ducked === null) return { ok: true, already: true };
  const restore = ducked;
  ducked = null;   // cleared first, so a failed restore can't wedge it ducked
  await api(`/me/player/volume?volume_percent=${restore}`, { method: "PUT" });
  return { ok: true, restored: restore };
}

export async function nowPlaying() {
  const { ok, data } = await api("/me/player/currently-playing");
  if (!ok || !data?.item) return null;
  return {
    title: data.item.name,
    artist: (data.item.artists || []).map(a => a.name).join(", "),
    playing: Boolean(data.is_playing),
  };
}
