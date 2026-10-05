import { describe, expect, it } from "vitest";
import { getPublicOrigin, requestWithPublicOrigin } from "./public-origin";

describe("getPublicOrigin", () => {
  it("uses the forwarded public protocol and host for tunneled requests", () => {
    const request = new Request("http://localhost:3102/api/oauth/consent", {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "scenario-tools.trycloudflare.com",
      },
    });

    expect(getPublicOrigin(request)).toBe(
      "https://scenario-tools.trycloudflare.com",
    );
  });

  it("uses the configured deployed origin instead of a loopback request", () => {
    const request = new Request("http://127.0.0.1:3000/api/gsc/oauth/start");

    expect(
      getPublicOrigin(request, "https://open-seo-selfhost.dom-5d1.workers.dev"),
    ).toBe("https://open-seo-selfhost.dom-5d1.workers.dev");
  });

  it("falls back to the request origin without proxy headers or config", () => {
    const request = new Request("http://localhost:3102/api/oauth/consent");

    expect(getPublicOrigin(request)).toBe("http://localhost:3102");
  });

  it("ignores forwarded hosts when the request is already public https", () => {
    const request = new Request("https://app.openseo.so/api/oauth/consent", {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "evil.test",
      },
    });

    expect(getPublicOrigin(request)).toBe("https://app.openseo.so");
  });
});

describe("requestWithPublicOrigin", () => {
  it("rewrites the request URL origin while preserving path and query", async () => {
    const request = new Request("http://localhost:3102/mcp?x=1", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "scenario-tools.trycloudflare.com",
      },
      body: JSON.stringify({ method: "initialize" }),
    });

    const publicRequest = requestWithPublicOrigin(request);

    expect(publicRequest.url).toBe(
      "https://scenario-tools.trycloudflare.com/mcp?x=1",
    );
    expect(publicRequest.method).toBe("POST");
    await expect(publicRequest.json()).resolves.toEqual({
      method: "initialize",
    });
  });
});
