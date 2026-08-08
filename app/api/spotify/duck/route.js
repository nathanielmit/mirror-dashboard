import { duck } from "../../../../lib/spotify";
export const dynamic = "force-dynamic";

// POST { on: true|false } — called by the voice daemon around a reply, so the
// music drops while the mirror is thinking and talking, then comes back.
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  return Response.json(await duck(Boolean(body.on)));
}
