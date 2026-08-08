"use client";
import { useEffect, useState } from "react";
export default function News() {
  const [items, setItems] = useState([]);
  const load = () => fetch("/api/news").then(r => r.json()).then(d => setItems(d.items||[])).catch(()=>{});
  useEffect(() => { load(); const t = setInterval(load, 900000); return () => clearInterval(t); }, []);
  return (
    <div className="card news">
      <div className="h">Tech Headlines</div>
      <ul>{items.slice(0,8).map((it,i)=>(<li key={i}><span>{i+1}</span>{it.title}</li>))}</ul>
    </div>
  );
}
