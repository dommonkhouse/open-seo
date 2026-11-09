import { beforeEach, describe, expect, it, vi } from "vitest";
import { getOAuthAccessToken } from "./oauth-access-token";

const mocks = vi.hoisted(() => ({
  findOAuthAccounts: vi.fn(),
  getAccessToken: vi.fn(),
}));
vi.mock("./repositories/AuthRepository", () => ({ AuthRepository: mocks }));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getAccessToken: mocks.getAccessToken } }),
}));

describe("OAuth grant selection for Better Auth 1.7", () => {
  beforeEach(() => {
    mocks.findOAuthAccounts.mockResolvedValue([
      { id: "row-a", accountId: "google-a" },
      { id: "row-b", accountId: "google-b" },
    ]);
    mocks.getAccessToken.mockResolvedValue({ accessToken: "token-b" });
  });

  it("scopes the lookup to the user and provider and forwards the selected row ID", async () => {
    await expect(
      getOAuthAccessToken("user", "google-analytics", "google-b"),
    ).resolves.toEqual({ accessToken: "token-b" });
    expect(mocks.findOAuthAccounts).toHaveBeenCalledWith(
      "user",
      "google-analytics",
    );
    expect(mocks.getAccessToken).toHaveBeenCalledWith({
      body: { userId: "user", accountId: "row-b" },
    });
  });

  it.each([undefined, "missing-google-id"])(
    "does not mint a token for a missing or ambiguous selection: %s",
    async (accountId) => {
      await expect(
        getOAuthAccessToken("user", "google-analytics", accountId),
      ).rejects.toThrow("missing or ambiguous");
      expect(mocks.getAccessToken).not.toHaveBeenCalled();
    },
  );

  it("supports a legacy connection without a subject only when one account exists", async () => {
    mocks.findOAuthAccounts.mockResolvedValue([
      { id: "row-a", accountId: "google-a" },
    ]);
    await getOAuthAccessToken("user", "google-search-console");
    expect(mocks.getAccessToken).toHaveBeenCalledWith({
      body: { userId: "user", accountId: "row-a" },
    });
  });
});
