// Google Calendar via its private "Secret address in iCal format" URL
// (GOOGLE_CALENDAR_ICS_URL). Read-only, no OAuth. Expands recurring events,
// honors deleted (EXDATE) and moved (RECURRENCE-ID) occurrences, and keeps a
// last-good cache so a network blip shows stale data.
import ical from "node-ical";
import { readCache, writeCache } from "./cache";

const HORIZON_DAYS = 14;
const MAX_EVENTS = 20;

// Exported for testing: turn raw ICS text into upcoming events (serializable).
export function expandICS(text, now = new Date()) {
  const data = ical.parseICS(text);
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 86400000);
  const lower = new Date(now.getTime() - 24 * 3600000); // catch in-progress events
  const out = [];

  const add = (ev, start, end, allDay) => {
    if (!start) return;
    if (end && end < now) return; // already over
    out.push({
      summary: (ev.summary || "(busy)").toString(),
      location: ev.location ? ev.location.toString() : "",
      allDay: !!allDay,
      start: start.toISOString(),
      end: end ? end.toISOString() : null,
    });
  };

  for (const k in data) {
    const ev = data[k];
    if (!ev || ev.type !== "VEVENT") continue;
    if (ev.recurrenceid) continue; // overrides handled via the parent's recurrences
    const allDay = ev.datetype === "date";

    if (ev.rrule) {
      const durMs = ev.end && ev.start ? ev.end - ev.start : 0;
      let occ = [];
      try { occ = ev.rrule.between(lower, horizon, true); } catch { occ = []; }
      for (const d of occ) {
        const iso = d.toISOString();
        const day = iso.slice(0, 10);
        if (ev.exdate && (ev.exdate[iso] || ev.exdate[day])) continue;
        const ov = ev.recurrences && (ev.recurrences[iso] || ev.recurrences[day]);
        if (ov) add(ov, ov.start, ov.end, ov.datetype === "date");
        else add(ev, d, new Date(d.getTime() + durMs), allDay);
      }
    } else {
      const start = ev.start;
      const end = ev.end || ev.start;
      if (start && start <= horizon) add(ev, start, end, allDay);
    }
  }
  out.sort((a, b) => new Date(a.start) - new Date(b.start));
  return out.slice(0, MAX_EVENTS);
}

// Returns { events, disabled? , stale? , cachedAt? }.
export async function getCalendar() {
  const url = process.env.GOOGLE_CALENDAR_ICS_URL;
  if (!url) return { events: [], disabled: true };
  try {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error("status " + r.status);
    const events = expandICS(await r.text());
    writeCache("calendar", { events });
    return { events, stale: false };
  } catch (e) {
    const cached = await readCache("calendar");
    if (cached) return { ...cached.data, stale: true, cachedAt: cached.at };
    return { events: [], error: true };
  }
}
