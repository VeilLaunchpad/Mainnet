import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pins a collection's public metadata - name, description, image, traits.
 *
 * This is the half of an NFT that is deliberately public: a marketplace has to
 * render something, and traits are what make a collection browsable. The
 * private half never comes near this route. It is encrypted in the creator's
 * browser under their own key and goes straight to the contract, so there is
 * no point at which this server could read it even if it wanted to.
 */
export async function POST(req: NextRequest) {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return Response.json({ error: "IPFS upload not configured" }, { status: 503 });

  const body = (await req.json().catch(() => null)) as {
    name?: string;
    description?: string;
    image?: string;
    attributes?: { trait_type: string; value: string }[];
  } | null;

  if (!body?.name) return Response.json({ error: "name is required" }, { status: 400 });

  const metadata = {
    name: String(body.name).slice(0, 120),
    description: String(body.description ?? "").slice(0, 2000),
    image: String(body.image ?? ""),
    attributes: (body.attributes ?? [])
      .filter((t) => t && t.trait_type && t.value)
      .slice(0, 40)
      .map((t) => ({ trait_type: String(t.trait_type).slice(0, 60), value: String(t.value).slice(0, 120) })),
  };

  const res = await fetch(
    (process.env.PINATA_BASE || "https://api.pinata.cloud") + "/pinning/pinJSONToIPFS",
    {
      method: "POST",
      headers: { authorization: "Bearer " + jwt, "content-type": "application/json" },
      body: JSON.stringify({ pinataContent: metadata, pinataOptions: { cidVersion: 1 } }),
    },
  );

  if (!res.ok) {
    return Response.json({ error: "pin failed: " + (await res.text()).slice(0, 200) }, { status: 502 });
  }

  const j = (await res.json()) as { IpfsHash?: string };
  if (!j.IpfsHash) return Response.json({ error: "pin returned no CID" }, { status: 502 });

  const gateway = process.env.NEXT_PUBLIC_PINATA_GATEWAY || "https://ipfs.io/ipfs/";
  return Response.json({ ok: true, cid: j.IpfsHash, url: gateway + j.IpfsHash });
}
