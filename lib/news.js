// News headlines (Hacker News front page) with last-good caching.
import { readCache, writeCache } from "./cache";

// Returns { items, stale, cachedAt? } or null if no data at all.
export async function getNews() {
  try {
    const r = await fetch("https://hn.algolia.com/api/v1/search?tags=front_page", { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error("status " + r.status);
    const d = await r.json();
    const items = (d.hits||[]).map(h => ({ title: h.title, url: h.url })).filter(x=>x.title);
    if (items.length) writeCache("news", { items }); // remember last-good (only if non-empty)
    return { items, stale: false };
  } catch (e) {
    const cached = await readCache("news");
    if (cached) return { ...cached.data, stale: true, cachedAt: cached.at };
    return null;
  }
}
