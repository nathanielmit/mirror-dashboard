import { getFeed } from "../../../lib/feed";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const feed = await getFeed();
  return Response.json(feed || { items: [], stale: true });
}
