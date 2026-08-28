export function shortAddr(a?: string | null, size = 4): string {
  if (!a) return "";
  if (a.length <= size * 2 + 2) return a;
  return a.slice(0, 2 + size) + "…" + a.slice(-size);
}

export function fmtNum(n: number | string | null | undefined, maxFrac = 4): string {
  const v = typeof n === "string" ? Number(n) : n;
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (v / 1e3).toFixed(2) + "K";
  if (abs < 1e-6) return v.toExponential(2);
  return v.toLocaleString("en-US", { maximumFractionDigits: maxFrac });
}

export function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  if (Math.abs(n) < 0.01 && n !== 0) return "$" + n.toExponential(2);
  return "$" + fmtNum(n, 2);
}

export function fmtUnits(value: bigint | string | null | undefined, decimals = 18, maxFrac = 4): string {
  if (value === null || value === undefined) return "-";
  const v = typeof value === "string" ? BigInt(value) : value;
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  const out = whole.toLocaleString("en-US") + (fracStr ? "." + fracStr : "");
  return (neg ? "-" : "") + out;
}

export function parseUnits(value: string, decimals = 18): bigint {
  const clean = value.trim().replace(/,/g, "");
  if (!clean || Number.isNaN(Number(clean))) return 0n;
  const [w, f = ""] = clean.split(".");
  const frac = (f + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return s + "s";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  return Math.floor(s / 86400) + "d";
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function isAddress(a: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(a);
}

/** BigInt-safe JSON for API responses. */
export function jsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  ) as T;
}

/**
 * Price rendering for tokens whose price is a very small number.
 *
 * A freshly launched token trades around 1e-8 COTI. Scientific notation is
 * unreadable at a glance and a run of literal zeros is worse, so we use the
 * subscript-zero convention every memecoin chart settled on:
 *
 *   0.000000011305  ->  0.0(7)11305   rendered as 0.0₇11305
 *
 * The subscript is the count of zeros between the decimal point and the first
 * significant digit.
 */
export interface SmallPrice {
  /** True when the value needs subscript notation. */
  compact: boolean;
  /** Zeros hidden behind the subscript. */
  zeros: number;
  /** Significant digits shown after the subscript. */
  digits: string;
  /** Ready-to-print form using Unicode subscripts. */
  text: string;
}

const SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉";

function subscript(n: number): string {
  return String(n)
    .split("")
    .map((d) => SUBSCRIPTS[Number(d)])
    .join("");
}

export function smallPrice(value: number | null | undefined, sigDigits = 5): SmallPrice {
  if (value === null || value === undefined || Number.isNaN(value) || value === 0) {
    return { compact: false, zeros: 0, digits: "", text: "0" };
  }

  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (abs >= 1) {
    const text = sign + abs.toLocaleString("en-US", { maximumFractionDigits: 4 });
    return { compact: false, zeros: 0, digits: text, text };
  }

  if (abs >= 0.001) {
    const text = sign + abs.toFixed(Math.min(8, sigDigits + 2)).replace(/0+$/, "").replace(/\.$/, "");
    return { compact: false, zeros: 0, digits: text, text };
  }

  // toFixed(20) keeps enough places that the leading zeros can be counted
  // without falling back to exponent form.
  const fixed = abs.toFixed(20);
  const frac = fixed.split(".")[1] || "";
  const firstSig = frac.search(/[1-9]/);
  if (firstSig < 0) return { compact: false, zeros: 0, digits: "0", text: "0" };

  const zeros = firstSig;
  const digits = frac.slice(firstSig, firstSig + sigDigits).replace(/0+$/, "") || "0";

  return {
    compact: true,
    zeros,
    digits,
    text: sign + "0.0" + subscript(zeros) + digits,
  };
}

/** One-line price string. Use the `<PriceText>` component when you can style it. */
export function fmtPrice(value: number | null | undefined, sigDigits = 5): string {
  return smallPrice(value, sigDigits).text;
}

/** USD price with the same subscript treatment, prefixed. */
export function fmtPriceUsd(value: number | null | undefined, sigDigits = 4): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  if (Math.abs(value) >= 0.01) return "$" + value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return "$" + smallPrice(value, sigDigits).text;
}
