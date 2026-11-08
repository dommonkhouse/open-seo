import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowStep } from "cloudflare:workers";
import type { createDataforseoClient } from "@/server/lib/dataforseo";
import { runQueuedCheck } from "./rankCheckPaths";

const mocks = vi.hoisted(() => ({
  insertSnapshots: vi.fn(),
  getSnapshotsForRun: vi.fn(),
  updateRun: vi.fn(),
  fetchRankCheckTaskResult: vi.fn(),
  rankCheckTaskPost: vi.fn(),
  sleep: vi.fn(),
  rankCheck: vi.fn(),
  steps: [] as string[],
}));

vi.mock(
  "@/server/features/rank-tracking/repositories/RankTrackingRepository",
  () => ({ RankTrackingRepository: mocks }),
);
vi.mock("@/server/lib/dataforseo", () => ({
  fetchRankCheckTaskResult: mocks.fetchRankCheckTaskResult,
  MAX_TASKS_PER_POST: 100,
}));
vi.mock("@/server/workflows/pgStep", () => ({
  pgStep: (
    _step: unknown,
    name: string,
    _config: unknown,
    fn: () => unknown,
  ) => {
    mocks.steps.push(name);
    return fn();
  },
}));

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only sleep is reached; pgStep is mocked
const step = { sleep: mocks.sleep } as unknown as WorkflowStep;
const result = {
  keywordId: "kw_1",
  keyword: "slow queued keyword",
  position: 12,
  url: null,
  serpFeatures: [],
};
const waits = [
  ["wait-0", "4 minutes"],
  ["wait-1", "2 minutes"],
  ["wait-2", "2 minutes"],
  ["wait-3", "2 minutes"],
  ["wait-4", "2 minutes"],
  ["wait-5", "3 minutes"],
  ["wait-6", "15 minutes"],
  ["wait-7", "15 minutes"],
  ["wait-8", "15 minutes"],
];

function checkContext() {
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- these are the only client methods used by runQueuedCheck
    client: {
      serp: {
        rankCheckTaskPost: mocks.rankCheckTaskPost,
        rankCheck: mocks.rankCheck,
      },
    } as unknown as ReturnType<typeof createDataforseoClient>,
    keywords: [{ id: "kw_1", keyword: "slow queued keyword" }],
    devices: "desktop" as const,
    serpDepth: 100,
    domain: "monkhouseandcompany.com",
    locationCode: 2826,
    languageCode: "en",
    runId: "run_1",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.steps.length = 0;
  mocks.fetchRankCheckTaskResult.mockReset();
  mocks.rankCheckTaskPost.mockResolvedValue([
    {
      taskId: "task_1",
      keywordId: "kw_1",
      keyword: "slow queued keyword",
      device: "desktop",
    },
  ]);
  mocks.getSnapshotsForRun.mockResolvedValue([{ trackingKeywordId: "kw_1" }]);
  mocks.rankCheck.mockResolvedValue(result);
});

describe("runQueuedCheck", () => {
  it.each([6, 7, 8])(
    "collects a late queued task at round %i without a paid live fallback",
    async (readyRound) => {
      for (let round = 0; round < readyRound; round++) {
        mocks.fetchRankCheckTaskResult.mockResolvedValueOnce({
          status: "pending",
        });
      }
      mocks.fetchRankCheckTaskResult.mockResolvedValueOnce({
        status: "completed",
        result,
      });

      await expect(runQueuedCheck(step, checkContext())).resolves.toEqual({
        queueTasks: 1,
        queueCollected: 1,
        fallbackTasks: 0,
        fallbackChecked: 0,
      });

      expect(mocks.sleep.mock.calls).toEqual(waits.slice(0, readyRound + 1));
      expect(mocks.steps).toEqual([
        "post-tasks-0",
        ...Array.from({ length: readyRound + 1 }, (_, i) => `collect-${i}`),
      ]);
      expect(mocks.insertSnapshots).toHaveBeenCalledExactlyOnceWith([
        expect.objectContaining({
          trackingKeywordId: "kw_1",
          position: 12,
          device: "desktop",
        }),
      ]);
      expect(mocks.rankCheck).not.toHaveBeenCalled();
    },
  );

  it("stops sleeping as soon as the original task completes", async () => {
    mocks.fetchRankCheckTaskResult.mockResolvedValue({
      status: "completed",
      result,
    });
    await runQueuedCheck(step, checkContext());
    expect(mocks.sleep.mock.calls).toEqual(waits.slice(0, 1));
    expect(mocks.rankCheck).not.toHaveBeenCalled();
  });

  it("retains the finite live fallback after all nine collection rounds", async () => {
    mocks.fetchRankCheckTaskResult.mockResolvedValue({ status: "pending" });
    await expect(runQueuedCheck(step, checkContext())).resolves.toEqual({
      queueTasks: 1,
      queueCollected: 0,
      fallbackTasks: 1,
      fallbackChecked: 1,
    });
    expect(mocks.sleep.mock.calls).toEqual(waits);
    expect(mocks.steps.at(-1)).toBe("fallback-batch-0");
    expect(mocks.fetchRankCheckTaskResult).toHaveBeenCalledTimes(9);
    expect(mocks.rankCheck).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        keywordId: "kw_1",
        keyword: "slow queued keyword",
        device: "desktop",
      }),
    );
  });
});
