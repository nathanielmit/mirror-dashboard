// Last-good cache: keeps the most recent successful payload in memory and on
// disk so a network blip serves stale data instead of "loading…" forever.
// Disk persistence means a service restart during an outage still has data.
import { promises as fs } from "fs";
import path from "path";

const DIR = path.join(process.cwd(), "data", "cache");
const mem = new Map(); // key -> { at, data }

export async function readCache(key) {
  if (mem.has(key)) return mem.get(key);
  try {
    const raw = await fs.readFile(path.join(DIR, key + ".json"), "utf8");
    const parsed = JSON.parse(raw); // { at, data }
    mem.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function writeCache(key, data) {
  const entry = { at: Date.now(), data };
  mem.set(key, entry);
  try {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(path.join(DIR, key + ".json"), JSON.stringify(entry));
  } catch {
    // disk write is best-effort; memory copy still serves this process
  }
}
