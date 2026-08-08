// Shared in-memory record of what the voice daemon is doing, so the page can
// display it. Deliberately not persisted: it is a live view, and none of it
// should outlive the process.
const MAX_EVENTS = 8;

let state = {
  status: "starting",   // starting | listening | thinking | speaking
  heard: "",            // last transcript, wake phrase or not
  reply: "",            // last thing spoken back
  updatedAt: 0,
  events: [],           // newest first
  counts: { heard: 0, wake: 0, error: 0 },
};

export function getVoiceState() {
  // ageMs lets the page distinguish "quiet" from "daemon died".
  return { ...state, ageMs: state.updatedAt ? Date.now() - state.updatedAt : null };
}

export function updateVoiceState(patch) {
  const { event, error, ...rest } = patch || {};
  state = { ...state, ...rest, updatedAt: Date.now() };

  if (event === "heard" || event === "wake" || event === "error") {
    state.counts = { ...state.counts, [event]: (state.counts[event] || 0) + 1 };
    state.events = [
      { at: Date.now(), kind: event, text: error || patch.heard || "" },
      ...state.events,
    ].slice(0, MAX_EVENTS);
  }
  return getVoiceState();
}
