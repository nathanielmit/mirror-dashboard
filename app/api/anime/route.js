// Lists animation clips dropped into public/anime/ (recursively, so you can
// organize by show) and groups them into themes.
//
// A theme is the filename prefix before any trailing digits — csm1.gif,
// csm2.gif ... all become "csm". Files in a subdirectory use the directory
// name instead, so dropping a folder in works too. The page shows one theme at
// a time and rotates through them, which is why the grouping lives here.
import { promises as fs } from "fs";
import path from "path";
export const dynamic = "force-dynamic";

const DIR = path.join(process.cwd(), "public", "anime");
const OK = /\.(gif|png|apng|webp|jpg|jpeg|webm|mp4|mov)$/i;

// Pretty names for the prefixes already in the library; anything unknown just
// gets title-cased, so new drops need no code change.
const LABELS = {
  csm: "Chainsaw Man", jjk: "Jujutsu Kaisen", toji: "Jujutsu Kaisen",
  opm: "One Punch Man", mob: "Mob Psycho", kat: "Katana",
  pokemon: "Pokémon", smash: "Smash Bros", zelda: "Zelda",
  retro: "Retro Gaming", sega: "Sega", gc: "GameCube", n: "Nintendo",
  ds: "Nintendo DS", vhs: "VHS Era",
};

async function walk(dir, base = "") {
  let out = [];
  let entries = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out = out.concat(await walk(path.join(dir, e.name), rel));
    else if (OK.test(e.name)) out.push(`/anime/${rel}`);
  }
  return out;
}

function themeOf(file) {
  const rel = file.replace(/^\/anime\//, "");
  const slash = rel.indexOf("/");
  if (slash > 0) return rel.slice(0, slash).toLowerCase();      // a folder wins
  return rel.replace(/\.[^.]+$/, "")                            // drop extension
            .replace(/[-_ ]?\d+$/, "")                          // drop trailing digits
            .toLowerCase() || "misc";
}

const label = (k) => LABELS[k] || k.replace(/(^|\s)\w/g, c => c.toUpperCase());

export async function GET() {
  const files = await walk(DIR);
  const groups = new Map();
  for (const f of files) {
    const k = themeOf(f);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  }
  // Merge by display name: "toji" and "jjk" are both Jujutsu Kaisen, and a
  // theme split in two shows up as two thin rotation slots.
  const byLabel = new Map();
  for (const [key, list] of groups) {
    const name = label(key);
    if (!byLabel.has(name)) byLabel.set(name, { key, label: name, files: [] });
    byLabel.get(name).files.push(...list);
  }

  // A theme with a single clip means 12 hours of one looping image, so pool
  // the one-offs together instead of giving each its own slot.
  const themes = [], singles = [];
  for (const t of byLabel.values()) (t.files.length >= 2 ? themes : singles).push(t);
  if (singles.length) {
    themes.push({
      key: "assorted",
      label: singles.length > 2 ? "Assorted" : singles.map(s => s.label).join(" & "),
      files: singles.flatMap(s => s.files),
    });
  }
  // Biggest themes first so the rotation leads with the richest sets.
  themes.sort((a, b) => b.files.length - a.files.length || a.key.localeCompare(b.key));

  return Response.json({ files, themes });
}
