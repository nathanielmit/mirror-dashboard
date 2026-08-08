"use client";
import { useEffect, useState } from "react";
export default function Weather() {
  const [w, setW] = useState(null);
  const load = () => fetch("/api/weather").then(r => r.json()).then(setW).catch(()=>{});
  useEffect(() => { load(); const t = setInterval(load, 600000); return () => clearInterval(t); }, []);
  if (!w) return <div className="card"><div className="h">Weather</div><div className="wmeta">loading…</div></div>;
  return (
    <div className="card" style={{ textAlign: "right" }}>
      <div className="h">{w.location}</div>
      <div style={{ display:"flex", alignItems:"center", gap:"14px", justifyContent:"flex-end" }}>
        <div className="temp">{Math.round(w.current.temp)}°</div>
      </div>
      <div className="wmeta">{w.current.desc} · feels {Math.round(w.current.feels)}°</div>
      <div className="fc">
        {w.daily.map((d,i) => (
          <div key={i}><div className="d">{d.day}</div><div className="t">{Math.round(d.hi)}° <span style={{color:"var(--dim)"}}>{Math.round(d.lo)}°</span></div></div>
        ))}
      </div>
    </div>
  );
}
