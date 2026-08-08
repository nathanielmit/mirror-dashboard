// Voice intent via the authenticated `claude` CLI (no API key needed).
// Live weather / todo / news data is fetched server-side and injected as
// context, then the model replies with a short spoken sentence. If the CLI is
// unavailable or the call fails (e.g. offline), we fall back to simple
// keyword handling so voice still works.
import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import fs from "fs";
import path from "path";
import { getWeather } from "./weather";
import { getNews } from "./news";
import { getTodos } from "./todos";
import { getCalendar } from "./calendar";

const execFileP = promisify(execFile);

const MODEL = process.env.MIRROR_LLM_MODEL || "haiku";
const TIMEOUT = 25000;

// How long one conversation stays alive before we start fresh. Measured from
// the first thing said, not the last — so a chat can't creep along all day.
const SESSION_TTL_MS = Number(process.env.MIRROR_VOICE_SESSION_MS || 60 * 60 * 1000);

const SYS = [
  "You are the voice of a magic mirror: a television panel mounted behind a pane of one-way glass, so you appear as text and light floating in the user's reflection.",
  "Adopt the manner of JARVIS, Tony Stark's AI companion — composed, courteous, quietly witty, unflappably competent. Dry understatement over enthusiasm. Never fawn, never pad.",
  "Critical: never address the user as 'sir', 'madam', 'ma'am', 'boss' or any other honorific — the real JARVIS says 'sir', but you must not. Simply omit the form of address entirely.",
  "Your words are spoken aloud by a text-to-speech voice, so reply with only the words to speak: one or two short sentences, no markdown, no lists, no emoji, no stage directions, and no surrounding quotes.",
  "This is an ongoing spoken conversation — remember what was said earlier and let follow-ups like 'what about tomorrow' refer back naturally.",
  "Each message includes LIVE DATA as JSON: the current time, weather and a multi-day forecast, the user's open todos (with rough minutes), upcoming calendar events, and news headlines. This data is refreshed every message, so always trust the newest one over anything said earlier.",
  "Answer from that data. If it doesn't cover the question, say so briefly. Never invent specific facts you weren't given.",
  "Round numbers for the ear: say 'a hundred degrees', never 'one hundred point five degrees'.",
  "",
  "MUSIC: you can play music on Spotify. When the user asks to play music, reply with ONLY a JSON object and no other text:",
  '{"spotify":{"query":"<what to search for>","mine":<true|false>},"say":"<what to say out loud>"}',
  'Set "mine" to true when they refer to their own library ("my anime playlist", "my liked songs mix"), false for a general request ("some lofi", "jazz for cooking").',
  'The "query" is the search text only — drop filler like "play", "some", "on spotify". "play me some lofi music on spotify" gives query "lofi".',
  'Keep "say" short and in character, e.g. "Putting on some lofi." Do not promise a specific playlist name — you do not know yet which one will be found.',
  "Use this JSON form ONLY for playing music. For anything else, reply with plain spoken words as normal.",
].join(" ");

// Haiku bonds "JARVIS" to "sir" tightly enough that prompting alone doesn't
// stop it, so the honorific comes off deterministically. Delete this to let
// the persona address you however it likes.
function dropHonorific(s) {
  return s
    .replace(/([,;]\s*)(sir|madam|ma'?am|boss)\b\s*([.!?]?)/gi, "$3")
    .replace(/^\s*(sir|madam|ma'?am|boss)[,.]\s*/i, "")
    .replace(/\s+([.!?,])/g, "$1")
    .trim();
}

// One rolling conversation, held in module scope. The `claude` CLI persists the
// real transcript to disk and hands back a session id we resume against.
let convo = { id: null, startedAt: 0 };

export function conversationState() {
  return { ...convo, ttlMs: SESSION_TTL_MS };
}

let _bin; // memoized binary path
function resolveBin() {
  if (_bin !== undefined) return _bin;
  const home = process.env.HOME || os.homedir();
  const candidates = [process.env.CLAUDE_BIN, path.join(home, ".local/bin/claude")].filter(Boolean);
  for (const c of candidates) {
    try { if (c.startsWith("/") && fs.existsSync(c)) { _bin = c; return _bin; } } catch {}
  }
  _bin = "claude"; // last resort: rely on PATH (failure -> graceful fallback)
  return _bin;
}

export function llmEnabled() {
  return process.env.MIRROR_VOICE_LLM !== "0";
}

// Fetch everything the assistant might reference, once per request.
export async function buildContext() {
  const [weather, todos, news, calendar] = await Promise.all([getWeather(), getTodos(), getNews(), getCalendar()]);
  return { weather, todos: todos || [], news: news || { items: [] }, calendar: calendar || { events: [] } };
}

// Returns { reply, spotify? } — a spoken line plus optional music intent.
function parseReply(s) {
  let t = String(s || "").trim();
  t = t.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "").trim(); // strip stray code fences
  if (t.startsWith("{")) {
    try {
      const o = JSON.parse(t);
      const say = dropHonorific(String(o.say || "").trim());
      // A music request comes back as structured intent for the caller to act
      // on; everything else is just words to speak.
      if (o.spotify && String(o.spotify.query || "").trim()) {
        return { reply: say, spotify: { query: String(o.spotify.query).trim(), mine: Boolean(o.spotify.mine) } };
      }
      if (say) return { reply: say };
    } catch {}
  }
  return { reply: dropHonorific(t.replace(/^["']|["']$/g, "").trim()) };
}

// Returns { reply, spotify? }, or null if the LLM path is unavailable/failed.
export async function askMirror(cmd, ctx) {
  const bin = resolveBin();
  const w = ctx.weather;
  const compact = {
    now: new Date().toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" }),
    // Round before the model sees it. Asking it to round in the prompt doesn't
    // stick, and "one hundred point five degrees" is grating read aloud.
    weather: w ? {
      location: w.location,
      current: w.current ? { ...w.current, temp: Math.round(w.current.temp), feels: Math.round(w.current.feels) } : null,
      forecast: (w.daily || []).map(d => ({ ...d, hi: Math.round(d.hi), lo: Math.round(d.lo) })),
      stale: !!w.stale,
    } : null,
    todos: (ctx.todos || []).filter(t => !t.done).map(t => ({ text: t.text, minutes: t.minutes })),
    schedule: (ctx.calendar?.events || []).map(e => ({ start: e.start, allDay: e.allDay, summary: e.summary })),
    headlines: (ctx.news?.items || []).slice(0, 8).map(h => h.title),
  };
  const prompt = `LIVE DATA (JSON):\n${JSON.stringify(compact)}\n\nThe user said: "${cmd}"\n\nReply with only what the mirror should say out loud — or, if this is a request to play music, only the JSON music object.`;

  // Resume the running conversation, unless it has aged out (or never began).
  const now = Date.now();
  const expired = convo.id && now - convo.startedAt > SESSION_TTL_MS;
  if (expired) convo = { id: null, startedAt: 0 };
  const resuming = Boolean(convo.id);

  // On resume the CLI already holds the system prompt and history, so we pass
  // only the new turn; a fresh conversation gets the persona installed.
  const args = resuming
    ? ["-p", prompt, "--resume", convo.id]
    : ["-p", prompt, "--system-prompt", SYS];
  args.push("--model", MODEL, "--output-format", "json", "--exclude-dynamic-system-prompt-sections");

  try {
    const { stdout } = await execFileP(bin, args,
      { cwd: os.tmpdir(), timeout: TIMEOUT, maxBuffer: 1 << 20, env: { ...process.env, HOME: process.env.HOME || os.homedir() } });
    let result;
    try {
      const parsed = JSON.parse(stdout);
      if (parsed.is_error || (parsed.subtype && parsed.subtype !== "success")) return null;
      result = parsed.result || "";
      if (parsed.session_id) {
        // Anchor the hour at the first exchange, not at every reply.
        if (!resuming) convo = { id: parsed.session_id, startedAt: now };
        else convo.id = parsed.session_id;
      }
    } catch { result = stdout; }
    const out = parseReply(result);
    return (out.reply || out.spotify) ? out : null;
  } catch (e) {
    // A resume can fail if the stored transcript was pruned. Drop the session
    // so the next utterance starts a clean conversation instead of looping.
    if (resuming) convo = { id: null, startedAt: 0 };
    return null; // timeout / not found / not authed -> caller falls back
  }
}

// Offline / no-LLM keyword fallback. Mirrors the old in-browser behavior.
export function fallbackReply(cmd, ctx) {
  const c = cmd.toLowerCase();
  const w = ctx.weather;
  if (/jacket|coat|cold|warm|umbrella|rain|snow/.test(c) && w) {
    const d = /tomorrow/.test(c) ? w.daily?.[1] : w.daily?.[0];
    if (d) return `${/tomorrow/.test(c) ? "Tomorrow" : "Today"} looks like ${d.desc}, with a high of ${Math.round(d.hi)} and a low of ${Math.round(d.lo)} degrees.`;
  }
  if (/forecast|weather|temperature|degrees|tomorrow/.test(c) && w) {
    if (/tomorrow/.test(c) && w.daily?.[1]) { const d = w.daily[1]; return `Tomorrow in ${w.location}: ${d.desc}, high of ${Math.round(d.hi)}, low of ${Math.round(d.lo)} degrees.`; }
    return `Right now it's ${Math.round(w.current.temp)} degrees and ${w.current.desc} in ${w.location}.`;
  }
  if (/headline|news/.test(c)) {
    const items = ctx.news?.items || [];
    if (items.length) return "Here are today's top headlines. " + items.slice(0, 3).map((x, i) => `${i + 1}. ${x.title}`).join(". ");
    return "I couldn't load the headlines.";
  }
  if (/schedule|calendar|agenda|meeting|appointment|what'?s on|my day/.test(c)) {
    const evs = ctx.calendar?.events || [];
    if (!evs.length) return "You have nothing coming up on your calendar.";
    const e = evs[0];
    const when = e.allDay ? "all day" : new Date(e.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return `Next up: ${e.summary}, ${when}.`;
  }
  if (/time|clock/.test(c)) return "It's " + new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (/to do|todo|task|first|next|should i/.test(c)) {
    const open = (ctx.todos || []).filter(t => !t.done).sort((a, b) => a.minutes - b.minutes);
    if (open.length) return `Your quickest task is ${open[0].text}, about ${open[0].minutes} minutes.`;
    return "Your todo list is all clear.";
  }
  if (/hello|hi there|you there/.test(c)) return "Hello! Ask me about the weather, your day, or the headlines.";
  return "I'm not sure how to answer that one yet.";
}
