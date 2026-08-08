import { exchangeCode } from "../../../../lib/spotify";
export const dynamic = "force-dynamic";

const page = (title, body) =>
  new Response(
    `<html><body style="background:#000;color:#e8e8ea;font:300 18px system-ui;padding:60px">
     <h2 style="font-weight:300">${title}</h2><p style="color:#7d7d86">${body}</p></body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );

// Spotify redirects here after consent. Swap the code for tokens and store them.
export async function GET(req) {
  const url = new URL(req.url);
  const err = url.searchParams.get("error");
  if (err) return page("Spotify declined", err);

  const code = url.searchParams.get("code");
  if (!code) return page("No code returned", "Start again at /api/spotify/auth");

  try {
    await exchangeCode(code);
    return page("Spotify linked", 'Try saying "hey mirror, play some lofi on spotify". You can close this tab.');
  } catch (e) {
    return page("Link failed", String(e.message || e));
  }
}
