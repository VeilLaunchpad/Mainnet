/**
 * The app's own public address.
 *
 * Server code needs this to call its own API and to hand Telegram a webhook
 * URL, but the value is not known until Railway assigns a domain, and
 * `NEXT_PUBLIC_*` variables are frozen into the bundle at build time. Resolving
 * it at runtime instead means the same image works on a preview domain, a
 * production domain and a laptop without being rebuilt.
 *
 * Order matters: an explicit setting wins so a custom domain can be pinned,
 * then Railway's injected domain, then localhost.
 */
export function appUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  const railway = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (railway) return "https://" + railway.replace(/\/+$/, "");

  return "http://localhost:" + (process.env.PORT || "3000");
}

/** True once the app is reachable from the internet, which webhooks require. */
export function isPubliclyReachable(): boolean {
  const url = appUrl();
  return url.startsWith("https://") && !url.includes("localhost");
}

/**
 * Whether this process is the real deployment.
 *
 * The bucket holds one line of snapshots for production. A developer running
 * `npm run dev` with the same `.env` would otherwise write their laptop's
 * database into that line, and a future restore could pick it up. Railway sets
 * these variables inside its own containers and nowhere else, so they are the
 * honest signal for "this instance owns the shared state".
 */
export function isManagedDeployment(): boolean {
  return !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
}

/**
 * The address people are given, as opposed to where the server happens to run.
 *
 * These are not the same thing and conflating them causes real bugs. `appUrl()`
 * resolves to the Railway origin, which is what Telegram must deliver to and
 * what server code calls itself on. The public face is the Vercel domain in
 * front of it, and that is the one that belongs in docs, share links and
 * anything a human copies.
 *
 * It is a `NEXT_PUBLIC_` value so the same string is available in the browser,
 * where documentation is rendered.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  return appUrl();
}
