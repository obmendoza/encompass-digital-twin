import { describe, it, expect } from "vitest";
import { extractJwt } from "../src/auth/jwt-verifier.js";

describe("extractJwt", () => {
  it("extracts from Authorization Bearer header", () => {
    expect(extractJwt({ headers: { authorization: "Bearer my-jwt" } })).toBe("my-jwt");
  });

  it("returns null for missing auth", () => {
    expect(extractJwt({ headers: {} })).toBeNull();
  });

  it("returns null for non-Bearer auth", () => {
    expect(extractJwt({ headers: { authorization: "Basic abc" } })).toBeNull();
  });

  it("extracts from Supabase auth cookie", () => {
    expect(extractJwt({
      headers: {},
      cookies: { "sb-xyz-auth-token": JSON.stringify({ access_token: "cookie-jwt" }) },
    })).toBe("cookie-jwt");
  });

  it("prefers Authorization header over cookie", () => {
    expect(extractJwt({
      headers: { authorization: "Bearer header-jwt" },
      cookies: { "sb-xyz-auth-token": JSON.stringify({ access_token: "cookie-jwt" }) },
    })).toBe("header-jwt");
  });
});
