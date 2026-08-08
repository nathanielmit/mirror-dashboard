"use client";
import { useEffect, useState } from "react";
export default function Todos() {
  const [todos, setTodos] = useState([]);
  const load = () => fetch("/api/todos").then(r => r.json()).then(d => setTodos(d.todos||[])).catch(()=>{});
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);
  // sort: not-done first, then by minutes ascending (lowest effort first)
  const sorted = [...todos].sort((a,b) => (a.done?1:0)-(b.done?1:0) || a.minutes-b.minutes);
  return (
    <div className="card todo">
      <div className="h">Today · quickest first</div>
      <ul>{sorted.map(t=>(
        <li key={t.id} className={t.done?"done":""}>
          <span className="m">{t.minutes}m</span>{t.text}
        </li>
      ))}</ul>
    </div>
  );
}
