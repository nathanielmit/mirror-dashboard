// How the page decides the voice daemon is alive.
//
// The daemon reports when it hears something, which is useless as a liveness
// signal: a quiet room looks exactly like a dead process. So it also sends an
// empty patch on a timer, purely to say "still here". Both numbers live here
// because the page's patience has to exceed the daemon's silence, and the two
// were previously separate constants in separate files with no stated relation.
//
// scripts/listen.py has its own copy of HEARTBEAT_MS — keep them in step.
export const HEARTBEAT_MS = 5000;

// Three missed beats. Long enough to ride out a slow transcription or a web
// server restart, short enough that a genuinely dead daemon shows up quickly.
export const STALE_MS = HEARTBEAT_MS * 3 + 5000;
