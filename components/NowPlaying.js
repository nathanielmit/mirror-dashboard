"use client";
import { useEffect, useState } from "react";

// One quiet line above the voice indicator showing what Spotify is playing.
// Renders nothing at all when the music is stopped, so the mirror stays clean
// when it isn't relevant.
const POLL_MS = 15000;

export default function NowPlaying() {
  const [track, setTrack] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/spotify/now", { cache: "no-store" })
        .then(r => r.json())
        .then(d => { if (alive) setTrack(d && d.playing ? d : null); })
        .catch(() => { if (alive) setTrack(null); });
    load();
    const t = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!track?.title) return null;

  return (
    <div className="nowplaying">
      <span className="np-note">♪</span>
      <span className="np-title">{track.title}</span>
      {track.artist ? <span className="np-artist">{track.artist}</span> : null}
    </div>
  );
}
