import { createHash, createHmac } from "node:crypto";

/**
 * A very small S3 client.
 *
 * The app needs four verbs against one bucket: put an object, get it, ask
 * whether it exists, and list a prefix. The AWS SDK brings tens of megabytes
 * and a plugin architecture to do that, which would dominate a container whose
 * whole point is being small. SigV4 is a well-specified algorithm, so it is
 * implemented here directly and verified against the real endpoint.
 *
 * Path style addressing is used deliberately: S3-compatible providers vary on
 * whether they support virtual host style, and `endpoint/bucket/key` works
 * everywhere.
 */

export interface BucketConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function bucketConfig(): BucketConfig | null {
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;

  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    region: process.env.S3_REGION || "auto",
    bucket,
    accessKeyId,
    secretAccessKey,
  };
}

export const bucketConfigured = () => bucketConfig() !== null;

/**
 * Why the last call failed.
 *
 * Returning a bare `false` from an upload hides whether the bucket rejected
 * the signature, the credentials, or the request shape, which turns a
 * five-minute fix into an afternoon. S3 explains itself in the response body,
 * so that explanation is kept.
 */
let lastError = "";
export const bucketLastError = () => lastError;

async function describe(res: Response | null, err?: unknown): Promise<string> {
  if (!res) {
    // Undici nests the useful part one level down, and the outer message is
    // always the same unhelpful "fetch failed".
    const e = err as { message?: string; cause?: { message?: string; code?: string } } | undefined;
    const cause = e?.cause;
    return (
      "network: " +
      (cause?.code ? cause.code + " " : "") +
      (cause?.message || e?.message || "unknown")
    );
  }
  const body = await res.text().catch(() => "");
  const code = body.match(/<Code>([^<]+)<\/Code>/)?.[1] ?? "";
  const message = body.match(/<Message>([^<]+)<\/Message>/)?.[1] ?? body.slice(0, 160);
  return `HTTP ${res.status}` + (code ? ` ${code}` : "") + (message ? `: ${message}` : "");
}

/* ------------------------------------------------------------------ */
/* Signing                                                             */
/* ------------------------------------------------------------------ */

const sha256Hex = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

/**
 * Each path segment is escaped, but the separators are not.
 *
 * `encodeURIComponent` leaves `!'()*` alone while AWS expects them encoded, so
 * they are finished off by hand. Getting this wrong produces a signature
 * mismatch on exactly the keys that contain punctuation, which is a miserable
 * bug to find later.
 */
function encodeKey(key: string): string {
  return key
    .split("/")
    .map((seg) =>
      encodeURIComponent(seg).replace(
        /[!'()*]/g,
        (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
      ),
    )
    .join("/");
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

function sign(
  cfg: BucketConfig,
  method: string,
  key: string,
  body: Buffer | null,
  query: Record<string, string> = {},
  extraHeaders: Record<string, string> = {},
  now = new Date(),
): SignedRequest {
  const host = new URL(cfg.endpoint).host;
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = sha256Hex(body ?? "");
  const canonicalUri = "/" + cfg.bucket + (key ? "/" + encodeKey(key) : "");

  // Query parameters must be sorted by name for the canonical request.
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(query[k]))
    .join("&");

  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...Object.fromEntries(Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase(), v])),
  };

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((h) => h + ":" + headers[h].trim() + "\n").join("");
  const signedHeaders = signedHeaderNames.join(";");

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = [dateStamp, cfg.region, "s3", "aws4_request"].join("/");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmac("AWS4" + cfg.secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, cfg.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = cfg.endpoint + canonicalUri + (canonicalQuery ? "?" + canonicalQuery : "");
  return { url, headers };
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

/** Object storage is not always on the same network as the app. */
const ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * One request, retried on connection failures only.
 *
 * A refused or timed-out connection is worth trying again; a 403 from a bad
 * signature is not, and retrying it would just spend three times as long
 * arriving at the same answer. So only thrown errors are retried, never a
 * response the server actually sent.
 */
async function send(
  url: string,
  init: RequestInit,
): Promise<{ res: Response | null; err: unknown }> {
  let err: unknown = null;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return { res, err: null };
    } catch (e) {
      err = e;
      if (attempt < ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
  }

  return { res: null, err };
}

/* ------------------------------------------------------------------ */
/* Verbs                                                               */
/* ------------------------------------------------------------------ */

export async function putObject(
  key: string,
  body: Buffer,
  contentType = "application/octet-stream",
): Promise<boolean> {
  const cfg = bucketConfig();
  if (!cfg) return false;

  const { url, headers } = sign(cfg, "PUT", key, body, {}, { "content-type": contentType });

  const { res, err } = await send(url, { method: "PUT", headers, body: new Uint8Array(body) });

  if (res?.ok) {
    lastError = "";
    return true;
  }

  lastError = await describe(res, err);
  console.warn("[bucket] put " + key + " failed: " + lastError);
  return false;
}

export async function getObject(key: string): Promise<Buffer | null> {
  const cfg = bucketConfig();
  if (!cfg) return null;

  const { url, headers } = sign(cfg, "GET", key, null);
  const { res, err } = await send(url, { headers });
  if (!res?.ok) {
    lastError = await describe(res, err);
    return null;
  }

  lastError = "";
  return Buffer.from(await res.arrayBuffer());
}

export async function headObject(key: string): Promise<{ size: number; modified: string } | null> {
  const cfg = bucketConfig();
  if (!cfg) return null;

  const { url, headers } = sign(cfg, "HEAD", key, null);
  const { res } = await send(url, { method: "HEAD", headers });
  if (!res?.ok) return null;

  return {
    size: Number(res.headers.get("content-length") || 0),
    modified: res.headers.get("last-modified") || "",
  };
}

export async function deleteObject(key: string): Promise<boolean> {
  const cfg = bucketConfig();
  if (!cfg) return false;

  const { url, headers } = sign(cfg, "DELETE", key, null);
  const { res } = await send(url, { method: "DELETE", headers });

  // S3 answers 204 for a delete, and treats a missing key as success.
  return !!res && (res.ok || res.status === 204);
}

export interface BucketObject {
  key: string;
  size: number;
  modified: string;
}

/** Lists a prefix, newest last. Enough for finding the most recent snapshot. */
export async function listObjects(prefix: string, max = 100): Promise<BucketObject[]> {
  const cfg = bucketConfig();
  if (!cfg) return [];

  const { url, headers } = sign(cfg, "GET", "", null, {
    "list-type": "2",
    prefix,
    "max-keys": String(max),
  });

  const { res, err } = await send(url, { headers });
  if (!res?.ok) {
    lastError = await describe(res, err);
    console.warn("[bucket] list " + prefix + " failed: " + lastError);
    return [];
  }

  lastError = "";
  const xml = await res.text();

  // A dependency-free parse is fine here: the response shape is fixed and the
  // only fields needed are the three below.
  const out: BucketObject[] = [];
  for (const block of xml.split("<Contents>").slice(1)) {
    const pick = (tag: string) =>
      block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1] ?? "";
    const key = pick("Key");
    if (key) out.push({ key, size: Number(pick("Size") || 0), modified: pick("LastModified") });
  }

  return out.sort((a, b) => a.modified.localeCompare(b.modified));
}
