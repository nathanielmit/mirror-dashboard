// Wake phrase shared by the browser (which decides whether to send anything at
// all) and the API route (which strips it before the model sees the words).
// Kept free of node imports so the client bundle can use it too.
//
// Matches "hey mirror", "okay mirror", "ok mirror" — optionally followed by a
// comma. Speech recognition punctuates unpredictably, so we stay loose.
export const WAKE_RE = /\b(?:hey|ok|okay)[\s,]+mirror\b/i;

export function hasWake(text) {
  return WAKE_RE.test(String(text || ""));
}

// Everything after the LAST wake phrase is the command. Using the last match
// means "hey mirror, uh, hey mirror what's the weather" still works.
export function stripWake(text) {
  const s = String(text || "");
  let out = s, m;
  const re = new RegExp(WAKE_RE.source, "gi");
  while ((m = re.exec(s)) !== null) out = s.slice(m.index + m[0].length);
  return out.replace(/^[\s,.:;!?-]+/, "").trim();
}
