import { readTodos, addTodo, patchTodo } from "../../../lib/todos";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await readTodos());
}

export async function POST(req) {
  const b = await req.json();
  const { doc } = await addTodo(b.text, b.minutes);
  return Response.json(doc);
}

export async function PATCH(req) {
  const b = await req.json();
  return Response.json(await patchTodo(b));
}
