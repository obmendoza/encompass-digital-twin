import { describe, it, expect } from "vitest";
import { validateUrlForFetch, checkResolvedIps } from "../src/ingestion/fetch-security.js";

describe("fetch-security — URL validation (layers 1+2)", () => {
  const allowed = ["docs.example.com", "files.cdn.example.com"];

  it("accepts https on an allowlisted host", () => {
    const r = validateUrlForFetch("https://docs.example.com/abc", allowed);
    expect(r.ok).toBe(true);
  });

  it("rejects http scheme", () => {
    const r = validateUrlForFetch("http://docs.example.com/abc", allowed);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("scheme_not_allowed");
  });

  it("rejects file://", () => {
    const r = validateUrlForFetch("file:///etc/passwd", allowed);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("scheme_not_allowed");
  });

  it("rejects data: and gopher:", () => {
    expect(validateUrlForFetch("data:text/plain,abc", allowed).reason).toBe("scheme_not_allowed");
    expect(validateUrlForFetch("gopher://h.example.com/", allowed).reason).toBe("scheme_not_allowed");
  });

  it("rejects host not in allowlist", () => {
    const r = validateUrlForFetch("https://attacker.example.com/", allowed);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("host_not_allowed");
  });

  it("rejects malformed URL", () => {
    expect(validateUrlForFetch("not a url", allowed).ok).toBe(false);
  });

  it("rejects empty allowlist regardless of URL", () => {
    const r = validateUrlForFetch("https://docs.example.com/abc", []);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("host_not_allowed");
  });
});

describe("fetch-security — IP-range gate (layer 3)", () => {
  it("blocks loopback IPv4", () => {
    expect(checkResolvedIps([{ address: "127.0.0.1", family: 4 }]).ok).toBe(false);
  });
  it("blocks loopback IPv6", () => {
    expect(checkResolvedIps([{ address: "::1", family: 6 }]).ok).toBe(false);
  });
  it("blocks RFC 1918 10/8", () => {
    expect(checkResolvedIps([{ address: "10.0.0.1", family: 4 }]).ok).toBe(false);
  });
  it("blocks RFC 1918 172.16/12", () => {
    expect(checkResolvedIps([{ address: "172.16.0.1", family: 4 }]).ok).toBe(false);
    expect(checkResolvedIps([{ address: "172.31.255.255", family: 4 }]).ok).toBe(false);
    expect(checkResolvedIps([{ address: "172.15.0.1", family: 4 }]).ok).toBe(true);
    expect(checkResolvedIps([{ address: "172.32.0.1", family: 4 }]).ok).toBe(true);
  });
  it("blocks RFC 1918 192.168/16", () => {
    expect(checkResolvedIps([{ address: "192.168.1.1", family: 4 }]).ok).toBe(false);
  });
  it("blocks link-local 169.254/16", () => {
    expect(checkResolvedIps([{ address: "169.254.169.254", family: 4 }]).ok).toBe(false);
  });
  it("blocks IPv6 fe80::/10 link-local", () => {
    expect(checkResolvedIps([{ address: "fe80::1", family: 6 }]).ok).toBe(false);
  });
  it("blocks IPv6 fc00::/7 ULA", () => {
    expect(checkResolvedIps([{ address: "fc00::1", family: 6 }]).ok).toBe(false);
    expect(checkResolvedIps([{ address: "fd00::1", family: 6 }]).ok).toBe(false);
  });
  it("accepts a public IPv4", () => {
    expect(checkResolvedIps([{ address: "8.8.8.8", family: 4 }]).ok).toBe(true);
  });
  it("rejects if ANY resolved IP is private (DNS rebinding defense)", () => {
    expect(checkResolvedIps([
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]).ok).toBe(false);
  });
});
