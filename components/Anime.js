"use client";
import { useEffect, useState } from "react";

// Animated decoration. Clips live in public/anime/ and are grouped into themes
// by /api/anime (Chainsaw Man, Retro Gaming, One Punch Man, Pokémon…).
//
// One theme is shown at a time and swaps every THEME_HOURS, so the mirror has
// a different character through the day rather than showing all 49 clips at
// random forever. Within a theme, each zone cycles its own clip on CLIP_MS.
//
// The theme is derived from the clock rather than stored, so every reload and
// every restart agrees on which theme is current — no state to persist, and
// the 4am refresh can't reshuffle it.
const THEME_HOURS = 1;
const CLIP_MS = 90 * 1000;   // swap the clip within a zone
const ZONES = ["left", "right"];

const isVideo = (s) => /\.(webm|mp4|mov)$/i.test(s);

function currentTheme(themes) {
  if (!themes.length) return null;
  const slot = Math.floor(Date.now() / (THEME_HOURS * 3600 * 1000));
  return themes[slot % themes.length];
}

// Deterministic per-zone starting offset so the two zones don't open on the
// same clip, without needing Math.random on first paint.
const pickFor = (files, n) => files[n % files.length];

export default function Anime() {
  const [themes, setThemes] = useState([]);
  const [theme, setTheme] = useState(null);
  const [tick, setTick] = useState(0);
  const [show, setShow] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/anime").then(r => r.json()).then(d => {
      if (!alive || !d.themes?.length) return;
      setThemes(d.themes);
      setTheme(currentTheme(d.themes));
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Re-check the theme periodically; the boundary can pass while the mirror
  // sits untouched for days.
  useEffect(() => {
    if (!themes.length) return;
    const t = setInterval(() => setTheme(currentTheme(themes)), 60 * 1000);
    return () => clearInterval(t);
  }, [themes]);

  // Cycle clips within the current theme, fading between them.
  useEffect(() => {
    if (!theme || theme.files.length < 2) return;
    const t = setInterval(() => {
      setShow(false);
      setTimeout(() => { setTick(n => n + 1); setShow(true); }, 500);
    }, CLIP_MS);
    return () => clearInterval(t);
  }, [theme]);

  if (!theme) return null;

  return (
    <>
      {ZONES.map((zone, zi) => {
        const src = pickFor(theme.files, tick * ZONES.length + zi);
        if (!src) return null;
        return (
          <div className={"anime anime-" + zone} key={zone}>
            <div className={"anime-frame" + (show ? " show" : "")}>
              {isVideo(src)
                ? <video key={src} src={src} autoPlay loop muted playsInline />
                : <img key={src} src={src} alt="" />}
            </div>
            {zi === 0 && <div className="anime-tag">{theme.label}</div>}
          </div>
        );
      })}
    </>
  );
}
