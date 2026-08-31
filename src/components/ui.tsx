import Link from "next/link";
import type { ReactNode } from "react";

export function Section({
  title,
  kicker,
  sub,
  right,
  children,
  className = "",
}: {
  title?: string;
  kicker?: string;
  sub?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={"mx-auto w-full max-w-[1400px] px-4 sm:px-6 " + className}>
      {(title || right) && (
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            {/* A label, not a second headline. Uppercase at 11px with wide
                tracking reads as a category marker; coloured and bold it
                competed with the title underneath it. */}
            {kicker && (
              <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-white/35">
                {kicker}
              </div>
            )}
            {/* Light weight and tight leading, per the type scale: a heading
                that sits as a block rather than shouting a line. */}
            {title && (
              <h2 className="text-[26px] leading-[1.04] tracking-[-0.018em] sm:text-[32px]">
                {title}
              </h2>
            )}
            {sub && (
              <p className="mt-2.5 max-w-2xl text-[14px] leading-relaxed text-white/45">{sub}</p>
            )}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "up" | "down";
}) {
  const color = tone === "up" ? "text-mint-400" : tone === "down" ? "text-rose-400" : "text-white";
  return (
    <div className="card px-4 py-4">
      <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/35">{label}</div>
      {/* Light weight at this size reads as a figure being stated rather than
          asserted, and the tabular numerals stop a changing value from
          shifting the layout under it. */}
      <div className={"mono mt-2 text-[22px] font-light tracking-[-0.02em] " + color}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-white/35">{sub}</div>}
    </div>
  );
}

export function Badge({
  children,
  tone = "devox",
}: {
  children: ReactNode;
  tone?: "devox" | "cy" | "mint" | "rose" | "amber" | "muted";
}) {
  const tones: Record<string, string> = {
    devox: "border-devox-400/30 bg-devox-500/10 text-devox-300",
    cy: "border-cy-400/30 bg-cy-500/10 text-cy-300",
    mint: "border-mint-400/30 bg-mint-400/10 text-mint-400",
    rose: "border-rose-400/30 bg-rose-400/10 text-rose-400",
    amber: "border-amber-400/30 bg-amber-400/10 text-amber-400",
    muted: "border-white/10 bg-white/5 text-white/50",
  };
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full border px-2 py-[3px] text-[10px] font-medium uppercase tracking-[0.12em] " +
        tones[tone]
      }
    >
      {children}
    </span>
  );
}

export function Progress({ pct, label }: { pct: number; label?: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: clamped + "%", background: "var(--accent)" }}
        />
      </div>
      {label && (
        <div className="mono mt-1 flex justify-between text-[10px] text-white/35">
          <span>{label}</span>
          <span>{clamped.toFixed(1)}%</span>
        </div>
      )}
    </div>
  );
}

export function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="panel flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex size-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-white/30">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.3" strokeDasharray="3 3" />
        </svg>
      </div>
      <h3 className="mt-4 text-[15px] font-medium">{title}</h3>
      <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-white/40">{body}</p>
      {action && (
        <Link
          href={action.href}
          className="btn-primary mt-5 px-4 py-2 text-[13px]"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={"skeleton rounded-lg " + className} />;
}

export function Avatar({
  src,
  seed,
  size = 40,
  rounded = "rounded-xl",
}: {
  src?: string;
  seed: string;
  size?: number;
  rounded?: string;
}) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className={"shrink-0 object-cover " + rounded}
        style={{ width: size, height: size }}
      />
    );
  }
  // Deterministic gradient from the seed so an avatar-less entity still reads
  // as a distinct identity rather than a grey blob.
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return (
    <div
      className={"flex shrink-0 items-center justify-center font-bold text-white " + rounded}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(135deg, hsl(${h} 72% 58%), hsl(${(h + 62) % 360} 74% 52%))`,
      }}
    >
      {seed.replace(/^0x/, "").slice(0, 1).toUpperCase()}
    </div>
  );
}
