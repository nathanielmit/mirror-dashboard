import { getNews } from "../../../lib/news";
export const dynamic = "force-dynamic";

export async function GET() {
  const n = await getNews();
  return n ? Response.json(n) : Response.json({ items: [] }, { status: 502 });
}
