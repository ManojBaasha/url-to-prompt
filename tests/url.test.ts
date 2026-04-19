import { describe, it, expect } from "vitest";
import { assertHttpUrl, hashUrl, normalizeUrl } from "../lib/url.js";

describe("normalizeUrl", () => {
  it("lowercases host, strips www and default port, removes fragment + tracking params, sorts query, trims trailing slash", () => {
    expect(
      normalizeUrl("HTTP://WWW.Example.COM:80/foo/?utm_source=x&b=2&a=1#frag")
    ).toBe("https://example.com/foo?a=1&b=2");
  });

  it("keeps root path as /", () => {
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
  });

  it("throws on invalid URLs", () => {
    expect(() => normalizeUrl("http://")).toThrow();
  });
});

describe("hashUrl", () => {
  it("returns the same hash for the same input", () => {
    expect(hashUrl("https://example.com/foo")).toBe(
      hashUrl("https://example.com/foo")
    );
  });

  it("returns different hashes for different inputs", () => {
    expect(hashUrl("https://example.com/foo")).not.toBe(
      hashUrl("https://example.com/bar")
    );
  });

  it("produces a hex SHA-256 (64 chars)", () => {
    expect(hashUrl("https://example.com")).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("assertHttpUrl", () => {
  it.each([
    "http://localhost",
    "http://127.0.0.1",
    "http://192.168.1.1",
    "http://10.0.0.5",
    "file:///etc/passwd",
    "javascript:alert(1)",
  ])("rejects %s", (url) => {
    expect(() => assertHttpUrl(url)).toThrow();
  });

  it.each(["https://example.com", "https://github.com"])("accepts %s", (url) => {
    expect(() => assertHttpUrl(url)).not.toThrow();
  });
});
