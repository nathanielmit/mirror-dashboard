"use client";
import { useEffect, useRef, useState } from "react";

// Continuously scrolling tech / anime / gaming headlines with a line of
// summary each. The list is rendered twice and translated by exactly half its
// height, so the loop point is seamless — no jump, no rewind.
const RELOAD_MS = 10 * 60 * 1000;   // refetch every 10 minutes
const PX_PER_SEC = 14;              // scroll speed; slow enough to read in passing

export default function Feed() {
  const [items, setItems] = useState([]);
  const [dur, setDur] = useState(60);
  const innerRef = useRef(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/feed", { cache: "no-store" })
        .then(r => r.json())
        .then(d => { if (alive) setItems(d.items || []); })
        .catch(() => {});
    load();
    const t = setInterval(load, RELOAD_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Duration is derived from real rendered height, so the speed stays constant
  // whether there are 12 stories or 45.
  useEffect(() => {
    const el = innerRef.current;
    if (!el || !items.length) return;
    const measure = () => {
      const half = el.scrollHeight / 2;
      if (half > 0) setDur(Math.max(30, half / PX_PER_SEC));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items]);

  if (!items.length) {
    return (
      <div className="card feed">
        <div className="h">Tech · Anime · Gaming</div>
        <div className="feed-empty">loading…</div>
      </div>
    );
  }

  const row = (it, i) => (
    <div className="fitem" key={i}>
      <div className="fmeta">
        <span className={"fcat fcat-" + it.cat}>{it.cat}</span>
        <span className="fsrc">{it.source}</span>
      </div>
      <div className="ftitle">{it.title}</div>
      {it.desc ? <div className="fdesc">{it.desc}</div> : null}
    </div>
  );

  return (
    <div className="card feed">
      <div className="h">Tech · Anime · Gaming</div>
      <div className="feed-view">
        <div className="feed-scroll" ref={innerRef} style={{ animationDuration: `${dur}s` }}>
          {items.map(row)}
          {/* second copy makes the wrap invisible */}
          {items.map((it, i) => row(it, i + items.length))}
        </div>
      </div>
    </div>
  );
}
