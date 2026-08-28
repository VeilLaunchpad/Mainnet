import { NextRequest } from "next/server";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { activeChain } from "@/lib/chain";
import { isAddress } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Source verification, fired automatically after a launch.
 *
 * CotiScan runs Blockscout, which accepts a Solidity standard JSON input. That
 * input is exactly what Hardhat wrote into artifacts/build-info at compile
 * time, so what gets submitted is byte-for-byte what produced the bytecode.
 * There is no flattening step to drift out of sync.
 *
 * A launch that fails to verify is still a working launch, so this endpoint
 * never blocks anything: it reports and moves on.
 */

const BUILD_INFO = path.resolve(process.cwd(), "contracts/artifacts/build-info");

interface BuildInfo {
  solcLongVersion: string;
  input: unknown;
  output: { contracts: Record<string, Record<string, unknown>> };
}

function buildInfoFor(contractName: string): { info: BuildInfo; sourcePath: string } | null {
  if (!existsSync(BUILD_INFO)) return null;

  for (const file of readdirSync(BUILD_INFO).filter((f) => f.endsWith(".json"))) {
    try {
      const info = JSON.parse(readFileSync(path.join(BUILD_INFO, file), "utf8")) as BuildInfo;
      for (const [sourcePath, contracts] of Object.entries(info.output.contracts ?? {})) {
        if (contractName in contracts) return { info, sourcePath };
      }
    } catch {
      /* a malformed build-info is not worth failing over */
    }
  }
  return null;
}

const explorer = () => activeChain.blockExplorers.default.url;

async function isVerified(address: string): Promise<boolean> {
  try {
    const res = await fetch(explorer() + "/api/v2/smart-contracts/" + address, {
      cache: "no-store",
    });
    if (!res.ok) return false;
    const j = (await res.json()) as { is_verified?: boolean };
    return !!j.is_verified;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address") || "";
  if (!isAddress(address)) return Response.json({ error: "address required" }, { status: 400 });

  const verified = await isVerified(address);
  return Response.json({
    address,
    verified,
    url: explorer() + "/address/" + address + "?tab=contract",
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, string>;
  const address = String(body.address || "");
  const contract = String(body.contract || "VeilToken");

  if (!isAddress(address)) return Response.json({ error: "invalid address" }, { status: 400 });

  if (await isVerified(address)) {
    return Response.json({
      ok: true,
      status: "already_verified",
      url: explorer() + "/address/" + address + "?tab=contract",
    });
  }

  const found = buildInfoFor(contract);
  if (!found) {
    return Response.json(
      {
        ok: false,
        status: "no_build_info",
        detail: "Compile the contracts so artifacts/build-info exists, then retry.",
      },
      { status: 503 },
    );
  }

  try {
    const form = new FormData();
    form.append("compiler_version", "v" + found.info.solcLongVersion);
    form.append("license_type", "mit");
    form.append("contract_name", found.sourcePath + ":" + contract);
    form.append("autodetect_constructor_args", "true");
    form.append(
      "files[0]",
      new Blob([JSON.stringify(found.info.input)], { type: "application/json" }),
      "standard-input.json",
    );

    const res = await fetch(
      explorer() + "/api/v2/smart-contracts/" + address + "/verification/via/standard-input",
      { method: "POST", body: form },
    );

    const text = await res.text();
    if (!res.ok) {
      return Response.json(
        { ok: false, status: "rejected", detail: text.slice(0, 200) },
        { status: 502 },
      );
    }

    // Blockscout queues the job, so this is accepted rather than finished.
    return Response.json({
      ok: true,
      status: "submitted",
      detail: text.slice(0, 160),
      url: explorer() + "/address/" + address + "?tab=contract",
    });
  } catch (err) {
    return Response.json(
      { ok: false, status: "error", detail: String(err).slice(0, 200) },
      { status: 502 },
    );
  }
}
