import { notePresence, status, wake } from "../../../lib/display";
export const dynamic = "force-dynamic";

// GET: current sleep state (handy over SSH: curl 127.0.0.1:3000/api/presence)
export async function GET() {
  return Response.json(status());
}

// POST { motion: bool } — the pixel face reports whether anyone moved.
// Also accepts { wake: true } to force the panel on.
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  if (body.wake) { await wake(); return Response.json(status()); }
  return Response.json(await notePresence(Boolean(body.motion)));
}
