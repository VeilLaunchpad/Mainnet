"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { fmtPrice, fmtNum, smallPrice } from "@/lib/format";

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  buys: number;
  sells: number;
}

interface CandleResponse {
  venue: "curve" | "devoxswap" | "none";
  timeframe: Timeframe;
  candles: Candle[];
  spotCoti: number | null;
  spotUsd: number | null;
  cotiUsd: number | null;
  issuedSupply: number | null;
  marketCapCoti: number | null;
  marketCapUsd: number | null;
  change: { pct: number; abs: number } | null;
  stats: { trades: number; buys: number; sells: number; volumeCoti: number };
}

const UP = "#26a69a";
const DOWN = "#ef5350";
const UP_SOFT = "rgba(38,166,154,0.5)";
const DOWN_SOFT = "rgba(239,83,80,0.5)";

/**
 * Candlestick chart over on-chain fills.
 *
 * Candles come from realised trades rather than a quoted book, because a
 * bonding curve has no book and a young pair has almost no depth. Every candle
 * traces back to transactions anyone can verify.
 */
export function PriceChart({
  token,
  symbol,
  refreshKey = 0,
}: {
  token: string;
  symbol: string;
  refreshKey?: number;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const scaleRef = useRef(1);

  const [tf, setTf] = useState<Timeframe>("5m");
  const [data, setData] = useState<CandleResponse | null>(null);
  const [denom, setDenom] = useState<"COTI" | "USD">("COTI");
  const [metric, setMetric] = useState<"price" | "mcap">("price");
  const [logScale, setLogScale] = useState(false);
  const [magnet, setMagnet] = useState(true);
  const [hover, setHover] = useState<Candle | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/candles?token=" + token + "&tf=" + tf)
      .then((r) => r.json())
      .then((j) => setData(j.error ? null : j))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [token, tf]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [load, refreshKey]);

  const candles = useMemo(() => data?.candles ?? [], [data]);

  /**
   * Multiplier applied to every displayed value: currency conversion, and for
   * market cap the issued supply.
   */
  const factor = useMemo(() => {
    const fx = denom === "USD" ? (data?.cotiUsd ?? 1) : 1;
    const supply = metric === "mcap" ? (data?.issuedSupply ?? 1) : 1;
    return fx * supply;
  }, [denom, metric, data?.cotiUsd, data?.issuedSupply]);

  /**
   * lightweight-charts derives its tick base from `1 / minMove`. At the
   * magnitudes a fresh launch trades at, that reciprocal stops being a clean
   * power of ten in floating point and the tick calculator throws
   * "unexpected base". So the series is scaled into a comfortable range before
   * it reaches the chart, and the axis formatter scales it back for display.
   */
  const scale = useMemo(() => {
    const sample = candles.length ? candles[candles.length - 1].close * factor : 0;
    if (!sample || !Number.isFinite(sample)) return 1;
    let s = 1;
    while (sample * s < 1) s *= 10;
    while (sample * s >= 1000) s /= 10;
    return s;
  }, [candles, factor]);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  const isMcap = metric === "mcap";
  const label = useCallback(
    (v: number) => {
      const real = v / scaleRef.current;
      return isMcap ? fmtNum(real, 2) : fmtPrice(real, 5);
    },
    [isMcap],
  );

  useEffect(() => {
    if (!holder.current) return;

    const chart = createChart(holder.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(255,255,255,0.42)",
        fontFamily: "ui-monospace, JetBrains Mono, monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.08)",
        scaleMargins: { top: 0.1, bottom: 0.26 },
        entireTextOnly: true,
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.08)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        barSpacing: 8,
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: {
          color: "rgba(255,255,255,0.28)",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#2b2b3d",
        },
        horzLine: {
          color: "rgba(255,255,255,0.28)",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#2b2b3d",
        },
      },
      height: 400,
      autoSize: true,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      // minMove 0.0001 gives base 10000, which is exact in floating point.
      priceFormat: { type: "custom", formatter: label, minMove: 0.0001 },
      priceLineWidth: 1,
      priceLineStyle: LineStyle.Dotted,
      priceLineColor: "rgba(255,255,255,0.35)",
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
      visible: false,
    });

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) return setHover(null);
      const point = param.seriesData.get(candleSeries) as
        | { open: number; high: number; low: number; close: number }
        | undefined;
      if (!point) return setHover(null);
      const vol = param.seriesData.get(volumeSeries) as { value: number } | undefined;
      const s = scaleRef.current;
      setHover({
        time: Number(param.time),
        open: point.open / s,
        high: point.high / s,
        low: point.low / s,
        close: point.close / s,
        volume: vol?.value ?? 0,
        buys: 0,
        sells: 0,
      });
    });

    chartRef.current = chart;
    candleRef.current = candleSeries;
    volumeRef.current = volumeSeries;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
    };
  }, [label]);

  useEffect(() => {
    chartRef.current?.priceScale("right").applyOptions({ mode: logScale ? 1 : 0 });
  }, [logScale]);

  useEffect(() => {
    chartRef.current?.applyOptions({
      crosshair: { mode: magnet ? CrosshairMode.Magnet : CrosshairMode.Normal },
    });
  }, [magnet]);

  useEffect(() => {
    if (!candleRef.current || !volumeRef.current || candles.length === 0) return;
    const k = factor * scale;

    candleRef.current.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open * k,
        high: c.high * k,
        low: c.low * k,
        close: c.close * k,
      })),
    );

    volumeRef.current.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? UP_SOFT : DOWN_SOFT,
      })),
    );

    chartRef.current?.timeScale().fitContent();
  }, [candles, factor, scale]);

  const last = candles.length ? candles[candles.length - 1] : null;
  const shown = hover ?? last;
  const changePct = data?.change?.pct ?? 0;
  const up = changePct >= 0;
  const empty = !loading && candles.length === 0;
  const unit = isMcap ? (denom === "USD" ? "$" : "") : "";

  const show = (v: number | null | undefined) => {
    if (v === null || v === undefined) return "-";
    const real = v * factor;
    return unit + (isMcap ? fmtNum(real, 2) : "");
  };



  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-black/25">
      <Toolbar
        tf={tf}
        setTf={setTf}
        metric={metric}
        setMetric={setMetric}
        denom={denom}
        setDenom={setDenom}
        hasMcap={!!data?.issuedSupply}
        hasUsd={!!data?.cotiUsd}
      />

      <div className="flex">
        <div className="relative min-w-0 flex-1">
          <Legend
            symbol={symbol}
            tf={tf}
            metric={metric}
            denom={denom}
            shown={shown}
            factor={factor}
            changePct={changePct}
            up={up}
            volume={shown?.volume ?? 0}
            show={show}
          />

          <div ref={holder} className={"h-[400px] w-full " + (empty ? "opacity-0" : "")} />

          {empty && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <div className="mono text-2xl font-semibold text-white/70">
                <PriceText value={(data?.spotCoti ?? 0) * (denom === "USD" ? (data?.cotiUsd ?? 1) : 1)} />
              </div>
              <div className="mt-1 text-[12px] text-white/35">No fills yet on this token.</div>
              <div className="mt-0.5 text-[11px] text-white/25">
                The first trade draws the first candle.
              </div>
            </div>
          )}

          {loading && candles.length === 0 && !empty && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="size-1.5 animate-pulse-slow rounded-full bg-devox-400"
                    style={{ animationDelay: i * 160 + "ms" }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <Footer data={data} symbol={symbol} logScale={logScale} setLogScale={setLogScale} />
    </div>
  );
}

function Toolbar({
  tf,
  setTf,
  metric,
  setMetric,
  denom,
  setDenom,
  hasMcap,
  hasUsd,
}: {
  tf: Timeframe;
  setTf: (t: Timeframe) => void;
  metric: "price" | "mcap";
  setMetric: (m: "price" | "mcap") => void;
  denom: "COTI" | "USD";
  setDenom: (d: "COTI" | "USD") => void;
  hasMcap: boolean;
  hasUsd: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.07] px-2.5 py-2">
      <div className="flex rounded-md bg-white/[0.04] p-0.5">
        {TIMEFRAMES.map((t) => (
          <button
            key={t}
            onClick={() => setTf(t)}
            className={
              "rounded px-2 py-1 text-[11px] font-semibold transition " +
              (tf === t ? "bg-white/[0.12] text-white" : "text-white/45 hover:text-white")
            }
          >
            {t}
          </button>
        ))}
      </div>

      <span className="h-4 w-px bg-white/10" />

      <div className="flex rounded-md bg-white/[0.04] p-0.5">
        {(["price", "mcap"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMetric(m)}
            disabled={m === "mcap" && !hasMcap}
            className={
              "rounded px-2 py-1 text-[11px] font-semibold uppercase transition disabled:opacity-30 " +
              (metric === m ? "bg-devox-500/30 text-devox-200" : "text-white/45 hover:text-white")
            }
          >
            {m === "price" ? "Price" : "MCap"}
          </button>
        ))}
      </div>

      <div className="flex rounded-md bg-white/[0.04] p-0.5">
        {(["COTI", "USD"] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDenom(d)}
            disabled={d === "USD" && !hasUsd}
            className={
              "rounded px-2 py-1 text-[11px] font-semibold transition disabled:opacity-30 " +
              (denom === d ? "bg-white/[0.12] text-white" : "text-white/45 hover:text-white")
            }
          >
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}

function Legend({
  symbol,
  tf,
  metric,
  denom,
  shown,
  factor,
  changePct,
  up,
  volume,
  show,
}: {
  symbol: string;
  tf: Timeframe;
  metric: "price" | "mcap";
  denom: "COTI" | "USD";
  shown: Candle | null;
  factor: number;
  changePct: number;
  up: boolean;
  volume: number;
  show: (v: number | null | undefined) => string;
}) {
  const isMcap = metric === "mcap";
  const val = (v: number | undefined) => {
    if (v === undefined) return <>-</>;
    return isMcap ? <>{show(v)}</> : <PriceText value={v * factor} />;
  };

  return (
    <div className="pointer-events-none absolute left-3 top-2.5 z-10 select-none">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px]">
        <span className="text-[12px] font-semibold text-white/85">{symbol} / COTI</span>
        <span className="text-white/30">{tf}</span>
        <span className="text-white/30">{isMcap ? "market cap" : "price"}</span>
        <span className="text-white/30">{denom}</span>
      </div>

      {shown && (
        <div className="mono mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px]">
          <span className="text-white/35">
            O <span className={up ? "text-mint-400" : "text-rose-400"}>{val(shown.open)}</span>
          </span>
          <span className="text-white/35">
            H <span className={up ? "text-mint-400" : "text-rose-400"}>{val(shown.high)}</span>
          </span>
          <span className="text-white/35">
            L <span className={up ? "text-mint-400" : "text-rose-400"}>{val(shown.low)}</span>
          </span>
          <span className="text-white/35">
            C <span className={up ? "text-mint-400" : "text-rose-400"}>{val(shown.close)}</span>
          </span>
          <span className={"font-semibold " + (up ? "text-mint-400" : "text-rose-400")}>
            {up ? "+" : ""}
            {changePct.toFixed(2)}%
          </span>
        </div>
      )}

      {volume > 0 && (
        <div className="mono mt-0.5 text-[11px] text-white/35">
          Volume <span className="text-cy-300">{fmtNum(volume, 4)}</span> COTI
        </div>
      )}
    </div>
  );
}

function Footer({
  data,
  symbol,
  logScale,
  setLogScale,
}: {
  data: CandleResponse | null;
  symbol: string;
  logScale: boolean;
  setLogScale: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-white/[0.07] px-3 py-2 text-[11px]">
      <span
        className={
          "rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider " +
          (data?.venue === "devoxswap" ? "bg-cy-500/15 text-cy-300" : "bg-devox-500/15 text-devox-300")
        }
      >
        {data?.venue === "devoxswap" ? "DevoxSwap" : "Bonding curve"}
      </span>

      {data && data.stats.trades > 0 && (
        <>
          <span className="text-white/35">
            <span className="mono text-white/70">{data.stats.trades}</span> fills
          </span>
          <span className="text-mint-400">
            <span className="mono">{data.stats.buys}</span> buys
          </span>
          <span className="text-rose-400">
            <span className="mono">{data.stats.sells}</span> sells
          </span>
          <span className="text-white/35">
            vol <span className="mono text-white/70">{fmtNum(data.stats.volumeCoti, 4)}</span> COTI
          </span>
        </>
      )}

      {data?.marketCapCoti ? (
        <span className="text-white/35">
          mcap <span className="mono text-white/70">{fmtNum(data.marketCapCoti, 2)}</span> COTI
        </span>
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={() => setLogScale(!logScale)}
          className={
            "rounded px-1.5 py-0.5 text-[10px] font-semibold transition " +
            (logScale ? "bg-devox-500/25 text-devox-200" : "text-white/30 hover:text-white")
          }
        >
          log
        </button>
        <span className="text-white/20">{symbol}</span>
      </div>
    </div>
  );
}

/**
 * Renders 0.0(7)11305 with a real subscript, so the zero count stays legible at
 * any font size rather than depending on the Unicode subscript glyphs.
 */
export function PriceText({ value }: { value: number | null | undefined }) {
  const p = smallPrice(value ?? 0, 5);
  if (!p.compact) return <>{p.text}</>;
  return (
    <>
      0.0
      <sub className="text-[0.7em] opacity-70">{p.zeros}</sub>
      {p.digits}
    </>
  );
}






