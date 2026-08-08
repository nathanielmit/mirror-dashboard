import { buildContext, askMirror, fallbackReply, llmEnabled } from "../../../lib/llm";
import { hasWake, stripWake } from "../../../lib/wake";
import { playRequest } from "../../../lib/spotify";
export const dynamic = "force-dynamic";

// The model proposes what to say before we've tried to play anything, so the
// spoken line has to be reconciled with what actually happened.
function spokenFor(res, proposed) {
  if (res.ok) {
    const what = res.playlist ? ` ${res.playlist}.` : "";
    const whose = res.source === "yours" ? " from your library" : "";
    return `${proposed || "Playing."}${what ? ` That's${whose}${what}` : ""}`.trim();
  }
  switch (res.reason) {
    case "not-found":       return "I couldn't find a playlist for that.";
    case "no-device":       return "I can't see the mirror's speaker on Spotify at the moment.";
    case "premium-required":return "Spotify only allows me to start playback on a Premium account.";
    case "not-linked":      return "Spotify isn't linked yet.";
    case "not-configured":  return "Spotify isn't set up yet.";
    default:                return "Spotify wouldn't start that, I'm afraid.";
  }
}

// Takes a voice transcript, returns { reply, source } for the caller to speak.
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const raw = String(body.transcript || "");
  // Second gate: the caller already checks for the wake phrase, but nothing
  // reaches the model without one — a stray POST can't start a conversation.
  if (!hasWake(raw)) return Response.json({ reply: "", source: "no-wake" });
  const cmd = stripWake(raw);
  if (!cmd) return Response.json({ reply: "I didn't catch that.", source: "empty" });

  const ctx = await buildContext();

  if (llmEnabled()) {
    const res = await askMirror(cmd, ctx);
    if (res?.spotify) {
      const play = await playRequest(res.spotify);
      return Response.json({
        reply: spokenFor(play, res.reply),
        source: "spotify",
        spotify: { ...play, query: res.spotify.query },
      });
    }
    if (res?.reply) return Response.json({ reply: res.reply, source: "llm" });
  }
  return Response.json({ reply: fallbackReply(cmd, ctx), source: "fallback" });
}
