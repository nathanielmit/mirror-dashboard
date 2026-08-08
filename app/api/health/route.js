// Liveness heartbeat. The browser POSTs here every few seconds while the page
// is actually rendering; the kiosk supervisor GETs here and relaunches Chromium
// if the heartbeat goes stale (white-screen / hung renderer).
export const dynamic = "force-dynamic";

let lastSeen = 0;

export async function GET() {
  const ageMs = lastSeen ? Date.now() - lastSeen : null;
  return Response.json({ ok: true, lastSeen, ageMs });
}

export async function POST() {
  lastSeen = Date.now();
  return Response.json({ ok: true });
}
