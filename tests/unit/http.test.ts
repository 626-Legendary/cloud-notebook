import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSameOrigin, isSecureRequest } from "@/lib/http";

describe("assertSameOrigin", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts the configured localhost and LAN origins", () => {
    vi.stubEnv("APP_URL", "http://localhost:3000,http://192.168.0.101:3000");

    expect(assertSameOrigin(new Request("http://192.168.0.101:3000/api/auth/login", {
      headers: { origin: "http://192.168.0.101:3000" }
    }))).toBe(true);
    expect(assertSameOrigin(new Request("http://localhost:3000/api/auth/login", {
      headers: { origin: "http://localhost:3000" }
    }))).toBe(true);
  });

  describe("isSecureRequest", () => {
    it("uses the direct request protocol when no proxy protocol is present", () => {
      expect(isSecureRequest(new Request("http://192.168.0.101:3000/api/auth/login"))).toBe(false);
      expect(isSecureRequest(new Request("https://notes.example.test/api/auth/login"))).toBe(true);
    });

    it("honors the external protocol forwarded by a reverse proxy", () => {
      expect(isSecureRequest(new Request("http://app:3000/api/auth/login", {
        headers: { "x-forwarded-proto": "https" }
      }))).toBe(true);
      expect(isSecureRequest(new Request("https://app:3000/api/auth/login", {
        headers: { "x-forwarded-proto": "http" }
      }))).toBe(false);
    });
  });

  it("accepts the origin used to reach the application even when APP_URL is localhost", () => {
    vi.stubEnv("APP_URL", "http://localhost:3000");

    expect(assertSameOrigin(new Request("http://192.168.0.101:3000/api/auth/login", {
      headers: { origin: "http://192.168.0.101:3000" }
    }))).toBe(true);
  });

  it("rejects unconfigured origins and malformed configuration", () => {
    vi.stubEnv("APP_URL", "http://localhost:3000,http://192.168.0.101:3000");

    expect(assertSameOrigin(new Request("http://192.168.0.101:3000/api/auth/login", {
      headers: { origin: "http://192.168.0.102:3000" }
    }))).toBe(false);

    vi.stubEnv("APP_URL", "not-a-url");
    expect(assertSameOrigin(new Request("http://localhost:3000/api/auth/login", {
      headers: { origin: "http://localhost:3000" }
    }))).toBe(false);
  });

  it("allows requests without an Origin header", () => {
    vi.stubEnv("APP_URL", "not-a-url");
    expect(assertSameOrigin(new Request("http://localhost:3000/api/auth/login"))).toBe(true);
  });
});
