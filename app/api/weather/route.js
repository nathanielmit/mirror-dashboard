import { getWeather } from "../../../lib/weather";
export const dynamic = "force-dynamic";

export async function GET() {
  const w = await getWeather();
  return w ? Response.json(w) : Response.json({ error: "weather unavailable" }, { status: 502 });
}
