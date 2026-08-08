"use client";
import { useEffect, useState } from "react";

function relDay(d, today) {
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

function format(ev, today) {
  if (ev.allDay) {
    // use the UTC date parts so the day doesn't shift across timezones
    const [Y, M, D] = ev.start.slice(0, 10).split("-").map(Number);
    return { day: relDay(new Date(Y, M - 1, D), today), time: "all day" };
  }
  const d = new Date(ev.start);
  return {
    day: relDay(new Date(d.getFullYear(), d.getMonth(), d.getDate()), today),
    time: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
  };
}

export default function Calendar() {
  const [data, setData] = useState(null);
  const load = () => fetch("/api/calendar").then(r => r.json()).then(setData).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 600000); return () => clearInterval(t); }, []);

  if (!data || data.disabled || !data.events?.length) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return (
    <div className="card cal">
      <div className="h">Schedule</div>
      <ul>
        {data.events.map((ev, i) => {
          const f = format(ev, today);
          return (
            <li key={i}>
              <span className="cday">{f.day}</span>
              <span className="ctime">{f.time}</span>
              <span className="cwhat">{ev.summary}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
