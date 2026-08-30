"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams, type ReadonlyURLSearchParams } from "next/navigation";
import Link from "next/link";
import { useAccount, useBalance, useWriteContract } from "wagmi";
import { parseEther, type Address } from "viem";
import { Section, Badge, Avatar, Skeleton, Stat } from "@/components/ui";
import { devoxSwapRouterAbi, devoxSwapFactoryAbi, erc20Abi } from "@/lib/abis";
import { isDeployed, SWAP_FEE_BPS } from "@/lib/addresses";
import { useNetwork, useNetworkClient } from "@/components/network-provider";
import { fmtNum, fmtUnits, parseUnits, shortAddr, isAddress } from "@/lib/format";
import { explorerTx, explorerAddress } from "@/lib/chain";
import { PrivacyNote } from "@/components/privacy-note";
import { ensureAllowance } from "@/lib/allowance";
import { CARBON_CONTROLLER, CARBON_NATIVE } from "@/lib/carbon";
import { carbonRouteAbi } from "@/lib/carbon-route";

interface PoolRow {
  address: string;
  name: string;
  symbol: string;
  image: string;
  pool: string;
  graduated: boolean;
  decimals: number;
}

/** A token with no DevoxSwap pool. Not an error here - just a different route. */
const NO_PAIR = "0x0000000000000000000000000000000000000000" as Address;

interface QuoteOk {
  ok: true;
  venue: "devoxswap" | "carbon";
  venueLabel: string;
  side: "buy" | "sell";
  token: string;
  decimals: number;
  amountIn: string;
  amountOut: string;
  partial: boolean;
  note: string;
  /** Carbon only: the exact orders to fill. */
  actions?: { strategyId: string; amount: string }[];
  strategiesUsed?: number;
}

type QuoteResponse = QuoteOk | { ok: false; error: string; message?: string };

export default function DefiPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[1400px] px-4 py-10">
          <Skeleton className="h-96" />
        </div>
      }
    >
      <DefiInner />
    </Suspense>
  );
}

function DefiInner() {
  const { net, addresses } = useNetwork();
  const params = useSearchParams();
  const { address } = useAccount();
  const publicClient = useNetworkClient();
  const { writeContractAsync } = useWriteContract();
  const { data: native } = useBalance({ address, query: { enabled: !!address } });

  const [pools, setPools] = useState<PoolRow[] | null>(null);
  const [custom, setCustom] = useState("");
  const [customToken, setCustomToken] = useState<PoolRow | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  /**
   * Which token this page opened on.
   *
   * Three shapes are accepted so a link from anywhere in the app lands
   * somewhere useful:
   *
   *   ?token=0x…              the token itself
   *   ?base=0x…&quote=0x…     a pair, the way a market link is usually written
   *
   * Every DevoxSwap pair is against COTI, so a base/quote link is resolved to
   * whichever side is not COTI - that is the token being traded, and the other
   * side is what it is priced in. A pair with COTI on neither side cannot be
   * routed here, and the page says so rather than silently picking one.
   */
  const [selected, setSelected] = useState<string>(() => initialToken(params));
  const [side, setSide] = useState<"buy" | "sell">(() => initialSide(params));
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<string | null>(null);
  /** The winning route, kept so the trade fills exactly what was quoted. */
  const [route, setRoute] = useState<QuoteOk | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const routerReady = isDeployed(addresses.swapRouter) && isDeployed(addresses.wcoti);

  // A pasted address is a first-class option: any ERC-20 on COTI can be traded
  // here, whether or not the launchpad ever indexed it and whether or not
  // DevoxSwap has a pool for it. If DevoxSwap cannot price it, the order book is
  // asked instead, so the requirement is only that the token exists.
  const all = useMemo(
    () => (customToken ? [...(pools ?? []), customToken] : (pools ?? [])),
    [pools, customToken],
  );
  const active = all.find((p) => p.address.toLowerCase() === selected.toLowerCase());

  /**
   * The address that needs its metadata read: a pasted one if there is one,
   * otherwise whatever is currently selected.
   *
   * The selection does not only come from the dropdown. A market link -
   * /swap?base=…&quote=… - names a token the launchpad has never indexed, and a
   * <select> whose value matches none of its options silently renders the first
   * one instead. That is not a cosmetic glitch: the picker read "DEVOX" while
   * the form was quoting and would have bought something else entirely. So the
   * selection is resolved the same way a pasted address is, and becomes a real
   * option in the list.
   */
  const wanted = useMemo(() => {
    const pasted = custom.trim();
    if (isAddress(pasted)) return pasted;
    return isAddress(selected) ? selected : "";
  }, [custom, selected]);

  useEffect(() => {
    const target = wanted;
    if (!isAddress(target) || !publicClient) {
      setCustomToken(null);
      return;
    }
    // Already a known pool token, so the dropdown can show it without help.
    if ((pools ?? []).some((p) => p.address.toLowerCase() === target.toLowerCase())) {
      setCustomToken(null);
      return;
    }
    // Already resolved. Re-fetching would loop.
    if (customToken && customToken.address.toLowerCase() === target.toLowerCase()) return;

    let alive = true;
    setLookingUp(true);
    const timer = setTimeout(async () => {
      try {
        // A pool is nice to have, not a requirement. Its absence just means the
        // quote will come from the order book instead.
        const pair = isDeployed(addresses.swapFactory)
          ? ((await publicClient
              .readContract({
                address: addresses.swapFactory,
                abi: devoxSwapFactoryAbi,
                functionName: "getPair",
                args: [target as Address, addresses.wcoti],
              })
              .catch(() => NO_PAIR)) as Address)
          : NO_PAIR;

        // Reading the metadata is the real test that this is a token at all.
        const [symbol, name, decimals] = await Promise.all([
          publicClient.readContract({ address: target as Address, abi: erc20Abi, functionName: "symbol" }),
          publicClient.readContract({ address: target as Address, abi: erc20Abi, functionName: "name" }),
          publicClient.readContract({ address: target as Address, abi: erc20Abi, functionName: "decimals" }),
        ]);

        if (!alive) return;
        setCustomToken({
          address: target,
          name: String(name),
          symbol: String(symbol),
          image: "",
          pool: pair,
          graduated: true,
          decimals: Number(decimals),
        });
        setSelected(target);
      } catch {
        if (alive) setCustomToken(null);
      } finally {
        if (alive) setLookingUp(false);
      }
    }, 400);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [wanted, publicClient, pools, customToken, addresses.swapFactory, addresses.wcoti]);

  useEffect(() => {
    fetch("/api/tokens?limit=50")
      .then((r) => r.json())
      .then((j) => {
        const list: PoolRow[] = (j.tokens || []).filter((t: PoolRow) => t.graduated && t.pool);
        setPools(list);
        setSelected((cur) => cur || list[0]?.address || "");
      })
      .catch(() => setPools([]));
  }, []);

  /**
   * Quotes come from the routing endpoint, which decides the venue.
   *
   * DevoxSwap when it has a pool, the order book when it does not. Both answers
   * come from the respective contract rather than a formula in this file, so
   * the number on screen is the number the trade will actually pay - and the
   * route it picked is carried back so the swap below fills the same orders
   * that were quoted.
   */
  useEffect(() => {
    setQuote(null);
    setRoute(null);
    setErr(null);
    if (!selected || !amount || Number(amount) <= 0) return;

    let alive = true;
    setQuoting(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          "/api/swap/quote?token=" + selected + "&side=" + side + "&amount=" + amount,
        );
        const q = (await res.json()) as QuoteResponse;
        if (!alive) return;

        if (!q.ok) {
          setQuote(null);
          setRoute(null);
          setErr(q.message ?? "Nothing can fill this trade right now.");
          return;
        }

        setRoute(q);
        setQuote(fmtUnits(q.amountOut, side === "buy" ? q.decimals : 18, 6));
      } catch {
        if (alive) {
          setQuote(null);
          setRoute(null);
        }
      } finally {
        if (alive) setQuoting(false);
      }
    }, 320);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [amount, side, selected, net]);

  /**
   * Fills the exact orders the quote named.
   *
   * An order-book trade is not a path through pools - it is a list of specific
   * strategies and how much of the input each one takes. The server worked that
   * out; sending anything else would fill different orders at a different price
   * than the one on screen, so the actions are passed through untouched.
   *
   * `minReturn` is the protection. Somebody else can trade the same orders
   * between the quote and the confirmation, and the contract will refuse rather
   * than fill at whatever is left.
   */
  async function tradeOnOrderBook(r: QuoteOk, deadline: bigint): Promise<`0x${string}`> {
    const actions = (r.actions ?? []).map((a) => ({
      strategyId: BigInt(a.strategyId),
      amount: BigInt(a.amount),
    }));
    if (actions.length === 0) throw new Error("The quote carried no orders to fill.");

    const token = selected as Address;
    const source = r.side === "buy" ? CARBON_NATIVE : token;
    const target = r.side === "buy" ? token : CARBON_NATIVE;
    const amountIn = BigInt(r.amountIn);
    const minReturn = (BigInt(r.amountOut) * 97n) / 100n; // 3%

    if (r.side === "sell") {
      await ensureAllowance({
        publicClient,
        writeContractAsync,
        owner: address as Address,
        token,
        spender: CARBON_CONTROLLER,
        amount: amountIn,
      });
    }

    return writeContractAsync({
      address: CARBON_CONTROLLER,
      abi: carbonRouteAbi,
      functionName: "tradeBySourceAmount",
      args: [source, target, actions, deadline, minReturn],
      value: r.side === "buy" ? amountIn : 0n,
      gas: 16_000_000n,
    });
  }

  async function swap() {
    if (!address) return setErr("Connect a wallet first.");
    if (!selected || !amount) return;
    if (!route) return setErr("Waiting for a quote.");
    if (route.venue === "devoxswap" && !routerReady) {
      return setErr("DevoxSwap is not configured on this network.");
    }

    setBusy(true);
    setErr(null);
    setTx(null);

    try {
      const decimals = active?.decimals ?? 18;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
      let hash: `0x${string}`;

      if (route.venue === "carbon") {
        hash = await tradeOnOrderBook(route, deadline);
      } else if (side === "buy") {
        hash = await writeContractAsync({
          address: addresses.swapRouter,
          abi: devoxSwapRouterAbi,
          functionName: "swapExactCotiForTokens",
          args: [selected as Address, 0n, address, deadline],
          value: parseEther(amount),
          gas: 16_000_000n,
        });
      } else {
        const amountIn = parseUnits(amount, decimals);

        // Only signs an approval when the existing allowance does not cover it,
        // so a repeat sell is a single confirmation.
        await ensureAllowance({
          publicClient,
          writeContractAsync,
          owner: address as Address,
          token: selected as Address,
          spender: addresses.swapRouter,
          amount: amountIn,
        });

        hash = await writeContractAsync({
          address: addresses.swapRouter,
          abi: devoxSwapRouterAbi,
          functionName: "swapExactTokensForCoti",
          args: [selected as Address, amountIn, 0n, address, deadline],
          gas: 16_000_000n,
        });
      }

      setTx(hash);
      await publicClient?.waitForTransactionReceipt({ hash });

      await fetch("/api/trades", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: selected,
          trader: address,
          side,
          cotiIn: side === "buy" ? amount : quote || "0",
          tokenOut: side === "buy" ? quote || "0" : amount,
          txHash: hash,
          venue: route.venue,
        }),
      }).catch(() => undefined);

      setAmount("");
    } catch (e) {
      setErr(String((e as Error).message || e).slice(0, 220));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="py-10">
      <Section
        kicker="Private DeFi"
        title="DevoxSwap - an AMM that can price an encrypted token"
        sub="Graduated launches trade here against real reserves. The routing is public; what you end up holding is not."
      >
        <div className="grid gap-3 lg:grid-cols-5">
          <div className="space-y-3 lg:col-span-2">
            <div className="card p-4">
              <div className="flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
                {(["buy", "sell"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setSide(s);
                      setAmount("");
                    }}
                    className={
                      "flex-1 rounded-lg py-2 text-[13px] font-semibold capitalize transition " +
                      (side === s
                        ? s === "buy"
                          ? "bg-mint-400/15 text-mint-400"
                          : "bg-rose-400/15 text-rose-400"
                        : "text-white/45 hover:text-white")
                    }
                  >
                    {s}
                  </button>
                ))}
              </div>

              <label className="mt-3 block text-[11px] font-semibold text-white/60">Token</label>
              <select
                value={selected}
                onChange={(e) => {
                  // Clearing the paste box matters: it is the higher-priority
                  // source, so leaving a stale address there would pull the
                  // selection straight back.
                  setCustom("");
                  setSelected(e.target.value);
                }}
                className="mt-1 w-full rounded-xl border border-white/10 bg-ink-850 px-3 py-2.5 text-[13px] outline-none transition focus:border-devox-400/50"
              >
                {all.length === 0 && <option value="">No pooled tokens yet</option>}
                {all.map((p) => (
                  <option key={p.address} value={p.address}>
                    {p.symbol} - {p.name}
                  </option>
                ))}
              </select>

              <label className="mt-3 block text-[11px] font-semibold text-white/60">You pay</label>
              <div className="mt-1 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 focus-within:border-devox-400/50">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder="0.0"
                  inputMode="decimal"
                  className="mono min-w-0 flex-1 bg-transparent text-lg outline-none placeholder:text-white/20"
                />
                <span className="shrink-0 text-[13px] font-semibold text-white/50">
                  {side === "buy" ? "COTI" : active?.symbol || "token"}
                </span>
              </div>
              {side === "buy" && native && (
                <button
                  onClick={() => setAmount(String(Math.max(0, Number(native.formatted) - 0.05)))}
                  className="mt-1 text-[10px] text-white/30 transition hover:text-white"
                >
                  balance {fmtNum(Number(native.formatted), 4)} COTI - use max
                </button>
              )}

              <div className="mt-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                <div className="flex items-center justify-between text-[11px] text-white/35">
                  <span>You receive</span>
                  {quoting && <span className="text-cy-300">quoting…</span>}
                </div>
                <div className="mono mt-0.5 text-lg font-semibold">
                  {quote ?? "-"}{" "}
                  <span className="text-[13px] font-normal text-white/45">
                    {side === "buy" ? active?.symbol || "" : "COTI"}
                  </span>
                </div>

                {/* Which venue filled it. Worth saying: a pool and an order
                    book behave differently, and only one of them can run out
                    halfway through a trade. */}
                {route && (
                  <div className="mt-2 border-t border-white/[0.06] pt-2">
                    <div className="flex items-center justify-between gap-2">
                      <Badge tone={route.venue === "devoxswap" ? "devox" : "cy"}>
                        {route.venue === "devoxswap" ? "DevoxSwap pool" : "Order book"}
                      </Badge>
                      {route.venue === "carbon" && route.strategiesUsed ? (
                        <span className="mono text-[10px] text-white/30">
                          {route.strategiesUsed} order{route.strategiesUsed === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </div>
                    {route.partial && (
                      <p className="mt-1.5 text-[10px] leading-relaxed text-amber-300/80">
                        Not enough depth for the whole amount. This quote fills{" "}
                        {fmtUnits(route.amountIn, side === "buy" ? 18 : route.decimals, 6)}{" "}
                        {side === "buy" ? "COTI" : active?.symbol || "token"} — the rest would have
                        nothing to trade against.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-3">
                <PrivacyNote
                  hidden={
                    active && active.address
                      ? ["your balance of this token, if it was launched with encrypted balances"]
                      : []
                  }
                  visible={[
                    "the swap itself",
                    "your address",
                    "the COTI amount",
                  ]}
                />
              </div>

              <label className="mt-3 block text-[11px] font-semibold text-white/60">
                Or paste a contract address
              </label>
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value.trim())}
                placeholder="0x..."
                className="mono mt-1 w-full rounded-xl border border-dashed border-white/10 bg-transparent px-3 py-2 text-[11px] outline-none transition placeholder:text-white/20 focus:border-cy-400/40"
              />
              {custom && (
                <p className="mt-1 text-[10px] leading-relaxed text-white/30">
                  {lookingUp
                    ? "Reading the token..."
                    : customToken
                      ? "Found " +
                        customToken.symbol +
                        (isDeployed(customToken.pool)
                          ? ". It has a DevoxSwap pool."
                          : ". No DevoxSwap pool, so it routes through the order book.")
                      : isAddress(custom)
                        ? "Nothing at that address answers like an ERC-20 on this network."
                        : "That is not a contract address."}
                </p>
              )}

              <button
                onClick={swap}
                disabled={busy || !selected || !amount || !route}
                className={
                  "mt-3 w-full rounded-xl py-3 text-[14px] font-semibold text-white transition hover:brightness-110 disabled:opacity-40 " +
                  (side === "buy"
                    ? "bg-gradient-to-r from-mint-400 to-cy-500"
                    : "bg-gradient-to-r from-rose-400 to-devox-500")
                }
              >
                {busy
                  ? "Swapping…"
                  : side === "buy"
                    ? "Buy " + (active?.symbol || "")
                    : "Sell " + (active?.symbol || "")}
              </button>

              {!routerReady && (
                <p className="mt-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.05] px-2.5 py-2 text-[11px] leading-relaxed text-amber-300/80">
                  DevoxSwap is not configured on this network. Deploy it and set
                  NEXT_PUBLIC_SWAP_ROUTER_TESTNET.
                </p>
              )}
              {err && <div className="mt-2 text-[11px] leading-relaxed text-rose-300">{err}</div>}
              {tx && (
                <a
                  href={explorerTx(tx, net)}
                  target="_blank"
                  rel="noreferrer"
                  className="mono mt-2 block truncate text-[11px] text-cy-300 hover:underline"
                >
                  {tx.slice(0, 20)}… ↗
                </a>
              )}

              <p className="mt-3 text-[10px] leading-relaxed text-white/25">
                Selling needs two signatures: an approval, then the swap. That is the ERC-20 dance,
                not something DEVOXPAD adds.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Stat label="Pools" value={pools?.length ?? "-"} sub="graduated launches" />
              <Stat label="Fee" value={SWAP_FEE_BPS / 100 + "%"} sub="to liquidity providers" />
            </div>
          </div>

          <div className="space-y-3 lg:col-span-3">
            <PoolList pools={pools} selected={selected} onSelect={setSelected} />
            <WhyDevoxSwap />
          </div>
        </div>
      </Section>
    </div>
  );
}

function PoolList({
  pools,
  selected,
  onSelect,
}: {
  pools: PoolRow[] | null;
  selected: string;
  onSelect: (a: string) => void;
}) {
  const { net, addresses } = useNetwork();
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Live pools</h2>
        {isDeployed(addresses.swapFactory) && (
          <a
            href={explorerAddress(addresses.swapFactory, net)}
            target="_blank"
            rel="noreferrer"
            className="mono text-[10px] text-white/25 transition hover:text-cy-300"
          >
            factory {shortAddr(addresses.swapFactory, 4)} ↗
          </a>
        )}
      </div>
      <p className="mt-1 text-[11px] text-white/35">
        Every launch that filled its curve seeded a pair here with its entire reserve.
      </p>

      <div className="mt-3 space-y-2">
        {pools === null ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)
        ) : pools.length === 0 ? (
          <div className="py-14 text-center">
            <p className="text-[13px] text-white/30">No launch has graduated yet.</p>
            <Link href="/launchpad" className="mt-2 inline-block text-[12px] text-cy-300 hover:underline">
              Find one close to filling →
            </Link>
          </div>
        ) : (
          pools.map((p) => (
            <div
              key={p.address}
              className={
                "flex items-center gap-3 rounded-xl border p-3 transition " +
                (selected.toLowerCase() === p.address.toLowerCase()
                  ? "border-devox-400/40 bg-devox-500/[0.06]"
                  : "border-white/[0.07]")
              }
            >
              <Avatar src={p.image} seed={p.symbol} size={34} rounded="rounded-lg" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-semibold">{p.symbol}/COTI</span>
                  <Badge tone="cy">0.3%</Badge>
                </div>
                <a
                  href={explorerAddress(p.pool, net)}
                  target="_blank"
                  rel="noreferrer"
                  className="mono text-[10px] text-white/30 transition hover:text-cy-300"
                >
                  pair {shortAddr(p.pool, 6)} ↗
                </a>
              </div>
              <button
                onClick={() => onSelect(p.address)}
                className="shrink-0 rounded-lg bg-white/[0.08] px-3 py-1.5 text-[11px] font-semibold transition hover:bg-white/[0.14]"
              >
                Trade
              </button>
              <Link
                href={"/coti/" + p.address}
                className="shrink-0 text-[11px] text-white/35 transition hover:text-cy-300"
              >
                open ↗
              </Link>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function WhyDevoxSwap() {
  return (
    <div className="card p-4">
      <h3 className="text-[13px] font-semibold">Why DEVOXPAD ships its own AMM</h3>
      <p className="mt-2 text-[12px] leading-relaxed text-white/50">
        Uniswap V2 works out what it holds by calling{" "}
        <span className="mono text-cy-300">balanceOf(address(this))</span>. A COTI PrivateERC20
        answers that with a <span className="mono text-cy-300">ctUint256</span> ciphertext handle,
        not a number - so a stock pair would compute nonsense reserves and be drained on the first
        trade.
      </p>
      <p className="mt-2 text-[12px] leading-relaxed text-white/50">
        A DevoxSwap pair never reads a balance. It pulls tokens itself with{" "}
        <span className="mono text-cy-300">transferFrom</span> and credits its own reserves, so the
        amount is known because the pair moved it. Everything else is V2: x·y=k, 0.3% to LPs, and a
        minimum liquidity burned forever so the pool can never be emptied.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-mint-400/20 bg-mint-400/[0.04] p-3">
          <div className="text-[12px] font-semibold text-mint-400">Stays private</div>
          <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-white/50">
            <li>Your token balance, as ciphertext in storage</li>
            <li>The size of any transfer you make outside a swap</li>
            <li>Aggregate supply of a private token</li>
          </ul>
        </div>
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-3">
          <div className="text-[12px] font-semibold text-amber-400">Stays public</div>
          <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-white/50">
            <li>Pair reserves and price - an AMM cannot work without them</li>
            <li>That a swap happened, its size, and against which pair</li>
            <li>Your native COTI balance and gas spend</li>
          </ul>
        </div>
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-white/30">
        Honest trade-off: a swap is public by construction. Privacy protects what you hold, not the
        act of trading it in a public pool.
      </p>
    </div>
  );
}

/* ── reading a market link ─────────────────────────────────────────────── */

/**
 * The addresses that mean "COTI itself" rather than an ERC-20.
 *
 * Carbon writes native COTI as the 0xEeee… sentinel, the launchpad writes it
 * as the zero address, and WCOTI is a real contract. All three mean the same
 * side of a pair here.
 */
const COTI_ALIASES = new Set(
  [
    "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    "0x0000000000000000000000000000000000000000",
  ].map((a) => a.toLowerCase()),
);

function isCoti(addr: string): boolean {
  return COTI_ALIASES.has(addr.toLowerCase());
}

function initialToken(params: URLSearchParams | ReadonlyURLSearchParams): string {
  const token = params.get("token");
  if (token && isAddress(token)) return token;

  const base = params.get("base") ?? "";
  const quote = params.get("quote") ?? "";

  // Whichever side is not COTI is the thing being traded.
  if (isAddress(base) && !isCoti(base)) return base;
  if (isAddress(quote) && !isCoti(quote)) return quote;
  return "";
}

/**
 * Which direction to open on.
 *
 * An explicit ?side= wins. Otherwise: buy.
 *
 * A market link can name COTI as its base - "COTI/USDCe" is a real row on the
 * Explore page - and it is tempting to read that as "you are looking at COTI,
 * so you must want to sell the other side for it". That opens a sell form for a
 * token the reader almost certainly does not hold. Every swap here is against
 * COTI anyway, so buying the other side is the useful default in both cases.
 */
function initialSide(params: URLSearchParams | ReadonlyURLSearchParams): "buy" | "sell" {
  return params.get("side") === "sell" ? "sell" : "buy";
}
