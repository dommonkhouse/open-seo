import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/server/lib/runtime-env", () => ({
  // AUTH_MODE unset: the deployment holds the DataForSEO key.
  getOptionalEnvValue: vi.fn(async () => undefined),
  getRequiredEnvValue: vi.fn(async () => "test-api-key"),
}));

import { resolveGotoUrls } from "@/server/lib/dataforseo/appendix";
import { getRequiredEnvValue } from "@/server/lib/runtime-env";

beforeEach(() => vi.clearAllMocks());

it("preserves a provider error when a failed task omits its result", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        status_code: 20000,
        tasks: [
          { status_code: 40001, status_message: "Invalid Field: 'goto_urls'." },
        ],
      }),
    ),
  );

  await expect(
    resolveGotoUrls(["https://google.com/goto?url=a"]),
  ).rejects.toThrow("Invalid Field: 'goto_urls'.");
});

it("maps each goto URL to its page and leaves out one it couldn't resolve", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      status_code: 20000,
      tasks: [
        {
          status_code: 20000,
          result: [
            {
              goto: "https://google.com/goto?url=a",
              url: "https://example.com/page",
            },
            { goto: "https://google.com/goto?url=b", url: null },
          ],
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const urls = [
    "https://google.com/goto?url=a",
    "https://google.com/goto?url=b",
  ];
  const resolved = await resolveGotoUrls(urls);

  expect([...resolved]).toEqual([
    ["https://google.com/goto?url=a", "https://example.com/page"],
  ]);
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("/v3/appendix/goto_url_converter"),
    expect.objectContaining({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic test-api-key",
      },
      body: JSON.stringify([{ goto_urls: urls }]),
    }),
  );
  expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  expect(getRequiredEnvValue).toHaveBeenCalledExactlyOnceWith(
    "DATAFORSEO_API_KEY",
  );
});
