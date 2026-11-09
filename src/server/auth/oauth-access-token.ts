import { getAuth } from "@/lib/auth";
import { AuthRepository } from "./repositories/AuthRepository";

/** Stored integration IDs are provider subjects; Better Auth 1.7 expects row IDs. */
export async function getOAuthAccessToken(
  userId: string,
  providerId: string,
  providerAccountId?: string,
) {
  const accounts = await AuthRepository.findOAuthAccounts(userId, providerId);
  const account = providerAccountId
    ? accounts.find((candidate) => candidate.accountId === providerAccountId)
    : accounts.length === 1
      ? accounts[0]
      : undefined;
  if (!account) throw new Error("OAuth account is missing or ambiguous");
  return getAuth().api.getAccessToken({
    body: { userId, accountId: account.id },
  });
}
