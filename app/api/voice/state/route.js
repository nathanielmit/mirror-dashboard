import { getVoiceState, updateVoiceState } from "../../../../lib/voiceState";
export const dynamic = "force-dynamic";

// GET: the page polls this to show what the mirror is hearing.
export async function GET() {
  return Response.json(getVoiceState());
}

// POST: the local voice daemon (scripts/listen.py) reports what it heard.
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  return Response.json(updateVoiceState(body));
}
