import { createHash } from "node:crypto";

const TRACKING_PARAMS = new Set(["fbclid", "gclid", "mc_cid", "mc_eid", "ref", "ref_src"]);

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  const hasScheme = /^[a-z][a-z0-9+.\-]*:/i.test(trimmed);
  const url = new URL(hasScheme ? trimmed : `https://${trimmed}`);

  if (url.protocol === "http:" || url.protocol === "https:") {
    url.protocol = "https:";
  }

  url.hostname = url.hostname.toLowerCase();
  if (url.hostname.startsWith("www.")) {
    url.hostname = url.hostname.slice(4);
  }

  if (url.port === "80" || url.port === "443") {
    url.port = "";
  }

  url.hash = "";

  const kept = Array.from(url.searchParams.entries())
    .filter(([key]) => !key.startsWith("utm_") && !TRACKING_PARAMS.has(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const sp = new URLSearchParams();
  for (const [k, v] of kept) sp.append(k, v);
  const query = sp.toString();

  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }

  const port = url.port ? `:${url.port}` : "";
  const qs = query ? `?${query}` : "";
  return `${url.protocol}//${url.hostname}${port}${path}${qs}`;
}

export function hashUrl(normalized: string): string {
  return createHash("sha256").update(normalized).digest("hex");
}

export function assertHttpUrl(input: string): void {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Protocol not allowed: ${url.protocol}`);
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isPrivateHost(host)) {
    throw new Error(`Private or loopback host not allowed: ${host}`);
  }
}

function isPrivateHost(host: string): boolean {
  if (host === "" || host === "localhost" || host === "::1" || host === "0.0.0.0") {
    return true;
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if ([a, b, Number(ipv4[3]), Number(ipv4[4])].some((n) => n < 0 || n > 255)) {
      return true;
    }
    if (a === 0) return true;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }

  if (/^fc/i.test(host) || /^fd/i.test(host)) return true;
  if (/^fe80/i.test(host)) return true;

  return false;
}
