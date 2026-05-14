import { lookup as dnsLookup } from "node:dns/promises";

export type FetchValidationReason =
  | "scheme_not_allowed"
  | "host_not_allowed"
  | "malformed_url"
  | "ip_range_blocked"
  | "dns_lookup_failed";

export interface FetchValidationResult {
  ok: boolean;
  reason?: FetchValidationReason;
  detail?: string;
}

export function validateUrlForFetch(url: string, allowedHosts: string[]): FetchValidationResult {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { ok: false, reason: "malformed_url" }; }
  if (parsed.protocol !== "https:") return { ok: false, reason: "scheme_not_allowed", detail: parsed.protocol };
  if (allowedHosts.length === 0 || !allowedHosts.includes(parsed.hostname)) {
    return { ok: false, reason: "host_not_allowed", detail: parsed.hostname };
  }
  return { ok: true };
}

interface ResolvedAddress { address: string; family: number; }

export function checkResolvedIps(addrs: ResolvedAddress[]): FetchValidationResult {
  for (const a of addrs) {
    if (isPrivateOrLocal(a)) return { ok: false, reason: "ip_range_blocked", detail: a.address };
  }
  return { ok: true };
}

function isPrivateOrLocal({ address, family }: ResolvedAddress): boolean {
  if (family === 4) {
    const parts = address.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
    const [a, b] = parts as [number, number, number, number];
    if (a === 127) return true;                                    // loopback
    if (a === 10) return true;                                     // RFC 1918
    if (a === 192 && b === 168) return true;                       // RFC 1918
    if (a === 172 && b >= 16 && b <= 31) return true;              // RFC 1918
    if (a === 169 && b === 254) return true;                       // link-local
    if (a === 0) return true;                                      // unspecified
    if (a >= 224) return true;                                     // multicast + reserved
    return false;
  }
  // IPv6
  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "::") return true;              // loopback / unspecified
  if (lower.startsWith("fe80:")) return true;                      // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA fc00::/7
  if (lower.startsWith("ff")) return true;                         // multicast
  return false;
}

export async function resolveAndCheck(hostname: string): Promise<FetchValidationResult> {
  try {
    const addrs = await dnsLookup(hostname, { all: true });
    return checkResolvedIps(addrs);
  } catch (e) {
    return { ok: false, reason: "dns_lookup_failed", detail: (e as Error).message };
  }
}

/**
 * Layer 4+5: redirect:'manual' and timeout+byte cap.
 * Returns the body as Uint8Array on success.
 */
export async function safeFetch(
  url: string,
  opts: { allowedHosts: string[]; maxBytes: number; timeoutMs: number },
): Promise<{ ok: true; bytes: Uint8Array; contentType: string | null } | { ok: false; reason: string; detail?: string }> {
  const v = validateUrlForFetch(url, opts.allowedHosts);
  if (!v.ok) return { ok: false, reason: v.reason ?? "invalid_url", detail: v.detail };
  const parsed = new URL(url);
  const ipCheck = await resolveAndCheck(parsed.hostname);
  if (!ipCheck.ok) return { ok: false, reason: ipCheck.reason ?? "ip_check_failed", detail: ipCheck.detail };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch(url, { redirect: "manual", signal: controller.signal });
    if (res.status >= 300 && res.status < 400) return { ok: false, reason: "unexpected_redirect" };
    if (res.status === 403 || res.status === 404) return { ok: false, reason: `status_${res.status}` };
    if (!res.ok) return { ok: false, reason: `status_${res.status}` };
    const reader = res.body?.getReader();
    if (!reader) return { ok: false, reason: "no_body" };

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > opts.maxBytes) {
        try { await reader.cancel(); } catch { /* swallow */ }
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { merged.set(c, offset); offset += c.byteLength; }
    return { ok: true, bytes: merged, contentType: res.headers.get("content-type") };
  } catch (e) {
    const msg = (e as Error).message;
    if (controller.signal.aborted) return { ok: false, reason: "timeout" };
    return { ok: false, reason: "fetch_error", detail: msg };
  } finally {
    clearTimeout(timer);
  }
}
