// Tech / anime / gaming headlines pulled from RSS + Atom feeds.
//
// Parsed with string matching rather than an XML library: these are a handful
// of well-formed feeds from stable publishers, and adding a parser dependency
// to a box that already compiles Rust and runs Whisper isn't worth it. Anything
// malformed simply yields no items for that source and the others carry on.
import { readCache, writeCache } from "./cache";

// Several of these 301 to a different path, so redirects are followed.
export const FEEDS = [
  { cat: "tech",   name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index" },
  { cat: "tech",   name: "The Verge",    url: "https://www.theverge.com/rss/index.xml" },
  { cat: "anime",  name: "ANN",          url: "https://www.animenewsnetwork.com/all/rss.xml" },
  { cat: "anime",  name: "MyAnimeList",  url: "https://myanimelist.net/rss/news.xml" },
  { cat: "gaming", name: "Polygon",      url: "https://www.polygon.com/feed/" },
  { cat: "gaming", name: "Eurogamer",    url: "https://www.eurogamer.net/feed" },
  { cat: "gaming", name: "PC Gamer",     url: "https://www.pcgamer.com/rss/" },
];

const PER_FEED = 8;      // newest N from each source before merging
const TOTAL = 45;        // cap on the merged list

const strip = (s) => s.replace(/<[^>]+>/g, " ");

const entities = (s) =>
  s
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");             // last, or it would double-decode

const decode = (s) => {
  let t = String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  t = strip(t);                          // markup that was already literal
  // Run the entity pass twice. Some feeds (MyAnimeList) double-encode, so the
  // raw text holds "&amp;#039;" — unescaping &amp; last recreates "&#039;"
  // after the numeric pass has gone by, and one pass leaves it visible.
  t = entities(entities(t));
  // Decoding &lt;/&gt; can also turn escaped markup into real tags — ANN
  // escapes <cite> inside descriptions — so strip a second time.
  return strip(t).replace(/\s+/g, " ").trim();
};

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : "";
};

// Atom puts the URL in an attribute rather than element text.
const linkOf = (xml) => {
  const rss = xml.match(/<link>([\s\S]*?)<\/link>/i);
  if (rss && rss[1].trim()) return decode(rss[1]);
  const atom = xml.match(/<link[^>]*href="([^"]+)"/i);
  return atom ? decode(atom[1]) : "";
};

function parse(xml, feed) {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  const out = [];
  for (const b of blocks.slice(0, PER_FEED)) {
    const title = tag(b, "title");
    if (!title) continue;
    const desc = tag(b, "description") || tag(b, "summary") || tag(b, "content:encoded");
    const when = tag(b, "pubDate") || tag(b, "published") || tag(b, "updated");
    const ts = when ? Date.parse(when) : NaN;
    out.push({
      title,
      // Long summaries get trimmed at a word boundary — this is read at a
      // glance from across a room, not studied.
      desc: desc.length > 180 ? desc.slice(0, 177).replace(/\s+\S*$/, "") + "…" : desc,
      url: linkOf(b),
      cat: feed.cat,
      source: feed.name,
      ts: Number.isFinite(ts) ? ts : 0,
    });
  }
  return out;
}

async function fetchOne(feed) {
  try {
    const r = await fetch(feed.url, {
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(9000),
      headers: { "User-Agent": "Mozilla/5.0 (mirror-dashboard)", Accept: "application/rss+xml, application/xml, text/xml, */*" },
    });
    if (!r.ok) return [];
    return parse(await r.text(), feed);
  } catch {
    return [];   // one dead feed must not take the panel down
  }
}

// Returns { items, stale, cachedAt? } or null when there's nothing at all.
export async function getFeed() {
  const results = await Promise.all(FEEDS.map(fetchOne));
  const items = results.flat();

  if (items.length) {
    // Interleave by category so the scroll doesn't run 20 gaming stories in a
    // row just because Eurogamer posts more often than the anime sources.
    const byCat = { tech: [], anime: [], gaming: [] };
    for (const it of items.sort((a, b) => b.ts - a.ts)) byCat[it.cat]?.push(it);
    const mixed = [];
    for (let i = 0; mixed.length < TOTAL; i++) {
      const before = mixed.length;
      for (const c of ["tech", "anime", "gaming"]) if (byCat[c][i]) mixed.push(byCat[c][i]);
      if (mixed.length === before) break;   // all sources exhausted
    }
    writeCache("feed", { items: mixed });
    return { items: mixed, stale: false };
  }

  const cached = await readCache("feed");
  if (cached) return { ...cached.data, stale: true, cachedAt: cached.at };
  return null;
}
