import { z } from "zod";
import type { AppendixUserDataResultInfo } from "dataforseo-client";
import { appendixApi } from "@/server/lib/dataforseo/core";
import { assertOk } from "@/server/lib/dataforseo/envelope";
import { getRequiredEnvValue } from "@/server/lib/runtime-env";
import { AppError } from "@/server/lib/errors";

const gotoResponseSchema = z.object({
  status_code: z.number(),
  status_message: z.string().optional(),
  tasks: z
    .array(
      z.object({
        status_code: z.number(),
        status_message: z.string().optional(),
        result: z
          .array(
            z.object({ goto: z.string(), url: z.string().url().nullish() }),
          )
          .nullish()
          .transform((rows) => rows ?? []),
      }),
    )
    .optional(),
});

/**
 * The real page behind each google.com/goto URL, keyed by that URL. A URL
 * DataForSEO couldn't resolve is left out. POST /v3/appendix/goto_url_converter
 * is free, so like fetchUserData this is deliberately not metered. Raw fetch
 * (not the SDK): the installed client has no converter method, and the auth
 * pattern matches the other appendix calls.
 */
export async function resolveGotoUrls(
  gotoUrls: string[],
): Promise<Map<string, string>> {
  const apiKey = await getRequiredEnvValue("DATAFORSEO_API_KEY");
  const response = await fetch(
    "https://api.dataforseo.com/v3/appendix/goto_url_converter",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${apiKey}`,
      },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify([{ goto_urls: gotoUrls }]),
    },
  );
  if (!response.ok) {
    throw new AppError(
      "INTERNAL_ERROR",
      `DataForSEO goto_url_converter failed (HTTP ${response.status})`,
    );
  }
  const task = assertOk(gotoResponseSchema.parse(await response.json()));
  return new Map(
    (task.result ?? []).flatMap(({ goto, url }) =>
      url ? [[goto, url] as const] : [],
    ),
  );
}

/**
 * Reads account spend + balance from DataForSEO's free GET
 * /v3/appendix/user_data. This is the standard, non-billable way to inspect
 * cost — unlike the other billing scripts, it does NOT make a live billable
 * call to observe spend, so there is nothing to meter and it is deliberately
 * NOT wired through meterDataforseoCall / client.ts.
 *
 * The result carries `money.total` (lifetime deposited), `money.balance`
 * (remaining), and `money.statistics.day` / `.minute` — spend grouped by
 * function (serp, keywords_data, backlinks, dataforseo_labs, on_page,
 * business_data, …) for the rolling day / minute window.
 *
 * SDK types are loose (every field optional + index signatures), so callers
 * must optional-chain into `.money.statistics.day`; it can be undefined.
 */
export async function fetchUserData(): Promise<
  AppendixUserDataResultInfo | undefined
> {
  const response = await appendixApi().userData();

  // Validates top-level + task status; the call is free so there is no billing
  // envelope to build.
  const task = assertOk(response);

  return task.result?.[0];
}
