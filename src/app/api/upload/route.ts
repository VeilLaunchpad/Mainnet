import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pins an image to IPFS via Pinata. The JWT stays server-side; the browser
 * only ever sees the resulting gateway URL.
 */
export async function POST(req: NextRequest) {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return Response.json({ error: "IPFS upload not configured" }, { status: 503 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "no file" }, { status: 400 });
  if (file.size > 5 * 1024 * 1024) {
    return Response.json({ error: "file too large (max 5MB)" }, { status: 413 });
  }

  const out = new FormData();
  out.append("file", file, file.name || "upload");
  out.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

  const res = await fetch((process.env.PINATA_BASE || "https://api.pinata.cloud") + "/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { authorization: "Bearer " + jwt },
    body: out,
  });

  if (!res.ok) {
    return Response.json({ error: "pin failed: " + (await res.text()).slice(0, 200) }, { status: 502 });
  }

  const j = (await res.json()) as { IpfsHash?: string };
  if (!j.IpfsHash) return Response.json({ error: "pin returned no CID" }, { status: 502 });

  const gateway = process.env.NEXT_PUBLIC_PINATA_GATEWAY || "https://ipfs.io/ipfs/";
  return Response.json({ ok: true, cid: j.IpfsHash, uri: "ipfs://" + j.IpfsHash, url: gateway + j.IpfsHash });
}
