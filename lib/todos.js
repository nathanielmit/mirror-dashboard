// Todo store (data/todos.json). Shared by the API route and the voice assistant.
import { promises as fs } from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "data", "todos.json");

export async function readTodos() {
  try { return JSON.parse(await fs.readFile(FILE, "utf8")); }
  catch { return { todos: [] }; }
}

async function writeTodos(d) {
  await fs.writeFile(FILE, JSON.stringify(d, null, 2));
}

export async function getTodos() {
  return (await readTodos()).todos;
}

// Adds a todo and returns { doc, added }.
export async function addTodo(text, minutes) {
  const d = await readTodos();
  const id = Math.max(0, ...d.todos.map(t => t.id)) + 1;
  const added = { id, text: (text || "untitled").trim(), minutes: Number(minutes) || 15, done: false };
  d.todos.push(added);
  await writeTodos(d);
  return { doc: d, added };
}

// Applies a partial update by id and returns the full doc.
export async function patchTodo(b) {
  const d = await readTodos();
  const t = d.todos.find(t => t.id === b.id);
  if (t) {
    if ("done" in b) t.done = b.done;
    if ("minutes" in b) t.minutes = Number(b.minutes);
    if ("text" in b) t.text = b.text;
  }
  await writeTodos(d);
  return d;
}
