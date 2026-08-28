import { NextRequest } from "next/server";
import { masterTable, chainDigest, invalidateMasterTable } from "@/lib/master";
import { networkFrom } from "@/lib/network";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The master table, served.
 *
 * `?section=contracts` returns one block; `?digest=1` returns the compact
 * summary the agents use. Everything here is public by construction - the
 * table holds addresses and config, never credentials.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  // Validated, so `?network=nonsense` falls back rather than 404ing on a
  // filename built from whatever the caller typed.
  const net = networkFrom(req);

  if (sp.get("refresh")) invalidateMasterTable();

  if (sp.get("digest")) {
    const digest = chainDigest(net);
    return digest
      ? Response.json(digest)
      : Response.json({ error: "no master table for " + net }, { status: 404 });
  }

  const table = masterTable(net);
  if (!table) {
    return Response.json(
      { error: "config/veilpad." + net + ".json not found" },
      { status: 404 },
    );
  }

  const section = sp.get("section");
  if (section) {
    const block = (table as unknown as Record<string, unknown>)[section];
    if (block === undefined) {
      return Response.json(
        { error: "unknown section", sections: Object.keys(table) },
        { status: 400 },
      );
    }
    return Response.json({ [section]: block });
  }

  return Response.json(table);
}
