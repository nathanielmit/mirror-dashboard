import { REDIRECT_URI, SCOPES, spotifyConfigured } from "../../../../lib/spotify";
export const dynamic = "force-dynamic";

// Visit this once in a browser to link the account. Sends you to Spotify's
// consent screen; Spotify then calls /api/spotify/callback with a code.
export async function GET() {
  if (!spotifyConfigured()) {
    return new Response(
      "Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env.local first, then restart mirror-web.",
      { status: 500, headers: { "Content-Type": "text/plain" } }
    );
  }
  const url = new URL("https://accounts.spotify.com/authorize");
  url.searchParams.set("client_id", process.env.SPOTIFY_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", SCOPES);
  // Force the consent screen so re-linking reliably returns a refresh token.
  url.searchParams.set("show_dialog", "true");
  return Response.redirect(url.toString(), 302);
}
