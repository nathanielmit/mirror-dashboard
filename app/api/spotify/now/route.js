import { nowPlaying, spotifyConfigured, spotifyLinked } from "../../../../lib/spotify";
export const dynamic = "force-dynamic";

// What's playing right now, for the line above the voice indicator.
// Answers quickly with playing:false when Spotify isn't set up, so the page
// doesn't wait on a network round trip that can't succeed.
export async function GET() {
  if (!spotifyConfigured() || !spotifyLinked()) return Response.json({ playing: false });
  const track = await nowPlaying();
  return Response.json(track ? { ...track } : { playing: false });
}
