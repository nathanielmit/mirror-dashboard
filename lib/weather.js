// Weather data (Open-Meteo) with last-good caching. Shared by the API route
// and the voice assistant so there's one source of truth.
import { LOCATION } from "./config";
import { readCache, writeCache } from "./cache";

const CODES = {0:"clear",1:"mostly clear",2:"partly cloudy",3:"overcast",45:"fog",48:"fog",51:"light drizzle",53:"drizzle",55:"drizzle",61:"light rain",63:"rain",65:"heavy rain",71:"light snow",73:"snow",75:"heavy snow",80:"rain showers",81:"rain showers",82:"heavy showers",85:"snow showers",86:"snow showers",95:"thunderstorms",96:"thunderstorms",99:"thunderstorms"};

// Returns { location, current, daily, stale, cachedAt? } or null if no data at all.
export async function getWeather() {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${LOCATION.lat}&longitude=${LOCATION.lon}&current=temperature_2m,apparent_temperature,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&temperature_unit=${LOCATION.tempUnit}&timezone=auto&forecast_days=4`;
  try {
    const r = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error("status " + r.status);
    const d = await r.json();
    const days = d.daily.time.map((t,i)=>({
      day: new Date(t+"T12:00:00").toLocaleDateString("en-US",{weekday:"short"}),
      hi: d.daily.temperature_2m_max[i], lo: d.daily.temperature_2m_min[i],
      desc: CODES[d.daily.weather_code[i]]||"—",
    }));
    const data = {
      location: LOCATION.name,
      current: { temp: d.current.temperature_2m, feels: d.current.apparent_temperature, desc: CODES[d.current.weather_code]||"—" },
      daily: days,
    };
    writeCache("weather", data); // remember last-good
    return { ...data, stale: false };
  } catch (e) {
    const cached = await readCache("weather");
    if (cached) return { ...cached.data, stale: true, cachedAt: cached.at };
    return null;
  }
}
