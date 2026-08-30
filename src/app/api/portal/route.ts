import type { Address } from "viem";
import { publicClient } from "@/lib/rpc";
import { devoxPortalAbi, devoxPortalTokenAbi, erc20Abi } from "@/lib/abis";
import { addressesFor, isDeployed } from "@/lib/addresses";
import { db, rows } from "@/lib/db";
import { fmtUnits } from "@/lib/format";
import { networkFrom } from "@/lib/network";
import { masterTable } from "@/lib/master";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PortalPair {
  underlying: Address;
  twin: Address;
  name: string;
  symbol: string;
  twinSymbol: string;
  decimals: number;
  locked: string;
  native: boolean;
}

const NATIVE = "0x0000000000000000000000000000000000000000" as Address;

interface AssetRow {
  symbol: string;
  name: string;
  decimals: number;
  address: Address;
  represents: string;
}

/**
 * Everything the portal page needs: which twins exist, how much sits in escrow
 * behind each, and which public tokens are worth offering as candidates.
 *
 * Escrow figures are public on purpose. A shielded pool that cannot be audited
 * for full backing is asking for trust it has not earned.
 */
export async function GET(req: Request) {
  const net = networkFrom(req);
  const addresses = addressesFor(net);

  if (!isDeployed(addresses.portal)) {
    return Response.json({
      deployed: false,
      portal: addresses.portal,
      pairs: [],
      candidates: [],
      network: net,
    });
  }

  const c = publicClient(net);

  let twins: Address[] = [];
  try {
    twins = (await c.readContract({
      address: addresses.portal,
      abi: devoxPortalAbi,
      functionName: "allTwins",
    })) as Address[];
  } catch {
    twins = [];
  }

  const pairs: PortalPair[] = [];
  for (const twin of twins) {
    try {
      const [underlying, twinSymbol, decimals] = await Promise.all([
        c.readContract({ address: twin, abi: devoxPortalTokenAbi, functionName: "underlying" }),
        c.readContract({ address: twin, abi: devoxPortalTokenAbi, functionName: "symbol" }),
        c.readContract({ address: twin, abi: devoxPortalTokenAbi, functionName: "decimals" }),
      ]);

      const under = underlying as Address;
      const native = under === NATIVE;

      const [name, symbol] = native
        ? ["COTI", "COTI"]
        : await Promise.all([
            c.readContract({ address: under, abi: erc20Abi, functionName: "name" }).catch(() => "Unknown"),
            c.readContract({ address: under, abi: erc20Abi, functionName: "symbol" }).catch(() => "?"),
          ]);

      const locked = (await c.readContract({
        address: addresses.portal,
        abi: devoxPortalAbi,
        functionName: "locked",
        args: [under],
      })) as bigint;

      pairs.push({
        underlying: under,
        twin,
        name: name as string,
        symbol: symbol as string,
        twinSymbol: twinSymbol as string,
        decimals: Number(decimals),
        locked: fmtUnits(locked, Number(decimals), 6),
        native,
      });
    } catch {
      /* a twin we cannot read is not worth showing */
    }
  }

  // The portal offers the same set a user would meet on mainnet, plus the
  // wrapper and any public launch. Private launches are already private and
  // have nothing to gain by crossing.
  /**
   * Only the testnet table carries stand-ins, and only those have an open
   * faucet. Reading the flag rather than assuming it is what stops a mainnet
   * response advertising a faucet on a real asset - which is exactly what
   * happened when this file was generated from the testnet one.
   */
  const assets = masterTable(net)?.assets as
    | { tokens?: AssetRow[]; testnet?: boolean }
    | undefined;
  const listed = assets?.tokens ?? [];
  const standIns = assets?.testnet === true;

  const launches = rows<{ address: string; name: string; symbol: string; decimals: number; kind: string }>(
    db()
      .prepare(
        "SELECT address, name, symbol, decimals, kind FROM tokens WHERE kind != 'private' AND network = ? ORDER BY created_at DESC LIMIT 30",
      )
      .all(net),
  );

  const candidates = [
    { address: NATIVE, name: "COTI", symbol: "COTI", decimals: 18, native: true, faucet: false },
    ...listed.map((a) => ({
      address: a.address,
      name: a.name,
      symbol: a.symbol,
      decimals: a.decimals,
      native: false,
      // Stand-ins carry an open faucet so the portal is usable without hunting
      // for testnet liquidity. Real assets do not, and must never say they do.
      faucet: standIns,
    })),
    ...(isDeployed(addresses.wcoti)
      ? [
          {
            address: addresses.wcoti,
            name: "Wrapped COTI",
            symbol: "WCOTI",
            decimals: 18,
            native: false,
            faucet: false,
          },
        ]
      : []),
    ...launches.map((l) => ({
      address: l.address,
      name: l.name,
      symbol: l.symbol,
      decimals: l.decimals,
      native: false,
      faucet: false,
    })),
  ];

  return Response.json({
    deployed: true,
    portal: addresses.portal,
    network: net,
    pairs,
    candidates,
    assetsAreTestnetStandIns: standIns && listed.length > 0,
    note: "Escrow is public so anyone can verify each twin is fully backed. Balances of the twins themselves are ciphertext.",
  });
}
