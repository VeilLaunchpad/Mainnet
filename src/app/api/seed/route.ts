import { seedHouseAgents } from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Idempotent - safe to hit on every boot. */
export async function POST() {
  return Response.json({ ok: true, ...seedHouseAgents() });
}

export async function GET() {
  return Response.json({ ok: true, ...seedHouseAgents() });
}
