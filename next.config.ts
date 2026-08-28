import type { NextConfig } from "next";

/**
 * The wagmi connectors barrel drags in Coinbase's Base Account SDK and the
 * MetaMask SDK, which soft-import optional packages for payments and React
 * Native. We only ever use the injected connector in a browser, so those paths
 * are unreachable at runtime - stub them rather than installing six packages
 * we will never call.
 */
const UNUSED_OPTIONAL_DEPS = [
  "@x402/core/client",
  "@x402/evm",
  "@x402/evm/exact/client",
  "@x402/evm/upto/client",
  "@x402/svm/exact/client",
  "@react-native-async-storage/async-storage",
  "pino-pretty",
];

const config: NextConfig = {
  /**
   * Ship only what the server actually needs.
   *
   * Standalone traces the imports and emits a self-contained server plus the
   * subset of node_modules it reached, which turns a container that carried the
   * whole dependency tree into a small one. The Dockerfile copies `public`,
   * `.next/static` and `config` alongside it, because file reads and static
   * assets are invisible to import tracing.
   */
  output: "standalone",

  reactStrictMode: true,
  serverExternalPackages: ["@coti-io/coti-ethers", "@coti-io/coti-sdk-private-messaging"],
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },

  turbopack: {
    resolveAlias: Object.fromEntries(UNUSED_OPTIONAL_DEPS.map((d) => [d, "./src/lib/noop.ts"])),
  },

  /**
   * Documents must be allowed to go stale.
   *
   * Next serves statically rendered pages with `s-maxage=31536000`. Directly
   * that is harmless, because a deploy replaces the server. Behind a CDN it is
   * a year: the edge kept serving an HTML document from an older build, and
   * that document referenced hashed CSS the new build no longer had, so the
   * site rendered with no stylesheet at all.
   *
   * Hashed assets under `/_next/static` are excluded and keep their immutable
   * caching, because their filenames change whenever their contents do.
   *
   * `/api` is excluded too, and that exclusion is not optional. Caching those
   * responses for thirty seconds broke anything that reads its own write:
   * claiming a handle wrote the profile, then the very next read came back
   * from the edge still saying there was none, so the prompt reappeared and
   * only a reconnect a minute later fixed it. Faucet status and balances were
   * going stale the same way.
   */
  async headers() {
    return [
      {
        source: "/((?!_next/static|_next/image|api/).*)",
        headers: [
          /**
           * `private`, not `public`, because a page is now rendered against
           * whichever network the visitor chose and that choice lives in a
           * cookie. A shared cache would hand one visitor's mainnet page to the
           * next visitor on testnet, contract addresses and all.
           *
           * `Vary: Cookie` would have been the cheaper fix and does not work
           * here: Next writes its own `Vary` for the router protocol on every
           * page response, after both `headers()` and middleware, so the entry
           * is dropped. Marking the response private is the part of the
           * contract a CDN cannot ignore. Static assets keep their long
           * immutable cache; only HTML gives up the thirty-second edge window.
           */
          { key: "Cache-Control", value: "private, no-cache, must-revalidate" },
        ],
      },
      {
        // Per-user and constantly changing. Never cache it anywhere.
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
        ],
      },
    ];
  },

  /**
   * `nextRuntime` matters here.
   *
   * `instrumentation.ts` is compiled for both the Node and the Edge runtimes,
   * so the bundler follows its imports into `lib/bucket` and `lib/db` even
   * though a runtime check stops them ever executing on Edge. Webpack then
   * fails on `node:crypto` and `node:sqlite`, which have no Edge equivalent,
   * and the whole dev server returns 500 for every route.
   *
   * Marking them external for that build leaves the import unresolved in a
   * bundle that never runs it, which is the accurate description of the
   * situation rather than a workaround.
   */
  webpack(cfg, { nextRuntime }) {
    if (nextRuntime === "edge") {
      const nodeOnly = ["node:crypto", "node:sqlite", "node:fs", "node:path"];
      cfg.externals = [
        ...(Array.isArray(cfg.externals) ? cfg.externals : cfg.externals ? [cfg.externals] : []),
        Object.fromEntries(nodeOnly.map((m) => [m, "commonjs " + m])),
      ];
    }

    cfg.resolve = cfg.resolve || {};
    cfg.resolve.alias = { ...(cfg.resolve.alias || {}) };
    for (const dep of UNUSED_OPTIONAL_DEPS) {
      (cfg.resolve.alias as Record<string, false>)[dep] = false;
    }
    return cfg;
  },
};

export default config;
