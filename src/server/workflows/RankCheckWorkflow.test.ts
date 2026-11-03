import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowStep } from "cloudflare:workers";
import {
  prepareRankCheckKeywords,
  RankCheckWorkflow,
} from "./RankCheckWorkflow";

const mocks = vi.hoisted(() => ({
  getConfigById: vi.fn(),
  getRunById: vi.fn(),
  getKeywordsForConfig: vi.fn(),
  updateRun: vi.fn(),
  updateConfig: vi.fn(),
  getSnapshotsForRun: vi.fn(),
  updateSnapshotUrls: vi.fn(),
  resolveGotoUrls: vi.fn(),
  autumnCheck: vi.fn(),
  createDataforseoClient: vi.fn(),
  runLiveCheck: vi.fn(),
  failRunIfActive: vi.fn(),
  captureServerEvent: vi.fn(),
  isHostedServerAuthMode: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  WorkflowEntrypoint: vi.fn(),
}));
vi.mock("cloudflare:workflows", () => ({
  NonRetryableError: class extends Error {},
}));
vi.mock("@/db", () => ({ withPgClient: (fn: () => unknown) => fn() }));
vi.mock(
  "@/server/features/rank-tracking/repositories/RankTrackingRepository",
  () => ({ RankTrackingRepository: mocks }),
);
vi.mock("@/server/features/rank-tracking/services/rankCheckRunGuards", () => ({
  failRunIfActive: mocks.failRunIfActive,
}));
vi.mock("@/server/workflows/rankCheckPaths", () => ({
  runLiveCheck: mocks.runLiveCheck,
  runQueuedCheck: vi.fn(),
}));
vi.mock("@/server/workflows/pgStep", () => ({
  pgStep: (
    _step: unknown,
    _name: string,
    _config: unknown,
    fn: () => unknown,
  ) => fn(),
}));
vi.mock("@/server/lib/dataforseo", () => ({
  createDataforseoClient: mocks.createDataforseoClient,
  MAX_GOTO_URLS_PER_REQUEST: 2,
  resolveGotoUrls: mocks.resolveGotoUrls,
}));
vi.mock("@/server/lib/posthog", () => ({
  captureServerEvent: mocks.captureServerEvent,
}));
vi.mock("@/server/billing/autumn", () => ({
  autumn: { check: mocks.autumnCheck },
}));
vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: mocks.isHostedServerAuthMode,
}));

const billingCustomer = {
  userId: "user_1",
  userEmail: "user@example.com",
  organizationId: "org_1",
  projectId: "project_1",
};

const activeRun = {
  id: "run_1",
  status: "running",
};

describe("rank check workflow credit ceiling", () => {
  beforeEach(() => {
    mocks.getRunById.mockResolvedValue(activeRun);
    mocks.updateRun.mockResolvedValue(undefined);
    mocks.isHostedServerAuthMode.mockResolvedValue(true);
    mocks.autumnCheck.mockResolvedValue({ balance: { remaining: 1_000 } });
  });

  it("rejects a keyword-list race before balance or DataForSEO calls", async () => {
    mocks.getConfigById.mockResolvedValue({ isActive: true });
    mocks.getKeywordsForConfig.mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => ({
        id: `kw_${index}`,
        keyword: `keyword ${index}`,
      })),
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the mocked base class does not inspect Worker constructor context
    const workflow = new RankCheckWorkflow({} as ExecutionContext, {} as Env);

    await expect(
      workflow.run(
        {
          instanceId: "run_1",
          timestamp: new Date(),
          payload: {
            runId: "run_1",
            configId: "config_1",
            billingCustomer,
            projectId: "project_1",
            domain: "example.com",
            locationCode: 2840,
            languageCode: "en",
            devices: "desktop",
            serpDepth: 10,
            trigger: "manual",
            maxCostCredits: 12,
          },
        },
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- workflow steps are executed directly by the pgStep mock
        {} as WorkflowStep,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(mocks.autumnCheck).not.toHaveBeenCalled();
    expect(mocks.createDataforseoClient).not.toHaveBeenCalled();
    expect(mocks.runLiveCheck).not.toHaveBeenCalled();
  });

  it("accepts the same reloaded list at the approved ceiling", async () => {
    mocks.getKeywordsForConfig.mockResolvedValue(
      Array.from({ length: 4 }, (_, index) => ({
        id: `kw_${index}`,
        keyword: `keyword ${index}`,
      })),
    );

    const result = await prepareRankCheckKeywords({
      runId: "run_1",
      configId: "config_1",
      billingCustomer,
      devices: "desktop",
      serpDepth: 10,
      trigger: "manual",
      maxCostCredits: 12,
    });

    expect(result.keywords).toHaveLength(4);
    expect(mocks.autumnCheck).toHaveBeenCalledTimes(2);
  });

  it("preserves callers that do not provide a ceiling", async () => {
    mocks.getKeywordsForConfig.mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => ({
        id: `kw_${index}`,
        keyword: `keyword ${index}`,
      })),
    );
    mocks.isHostedServerAuthMode.mockResolvedValue(false);

    const result = await prepareRankCheckKeywords({
      runId: "run_1",
      configId: "config_1",
      billingCustomer,
      devices: "desktop",
      serpDepth: 10,
      trigger: "manual",
    });

    expect(result.keywords).toHaveLength(5);
    expect(mocks.autumnCheck).not.toHaveBeenCalled();
  });
});

const gotoUrl = (id: number) => `https://google.com/goto?url=${id}`;

const keywords = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `kw_${index}`,
    keyword: `keyword ${index}`,
  }));

async function runWorkflow({
  trigger = "scheduled",
}: { trigger?: "scheduled" | "manual" } = {}) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the mocked base class does not inspect Worker constructor context
  const workflow = new RankCheckWorkflow({} as ExecutionContext, {} as Env);

  await workflow.run(
    {
      instanceId: "run_1",
      timestamp: new Date(),
      payload: {
        runId: "run_1",
        configId: "config_1",
        billingCustomer,
        projectId: "project_1",
        domain: "example.com",
        locationCode: 2840,
        languageCode: "en",
        devices: "desktop",
        serpDepth: 10,
        trigger,
        maxCostCredits: 12,
      },
    },
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- workflow steps are executed directly by the pgStep mock
    {} as WorkflowStep,
  );
}

describe("rank check goto URLs", () => {
  const gotoSnapshot = (id: number) => ({
    id,
    trackingKeywordId: `kw_${id}`,
    device: "desktop",
    url: gotoUrl(id),
  });

  beforeEach(() => {
    mocks.getConfigById.mockResolvedValue({ isActive: true });
    mocks.getRunById.mockResolvedValue({ ...activeRun, keywordsTotal: 1 });
    mocks.getKeywordsForConfig.mockResolvedValue(keywords(1));
    mocks.updateRun.mockResolvedValue(undefined);
    mocks.isHostedServerAuthMode.mockResolvedValue(true);
    mocks.autumnCheck.mockResolvedValue({ balance: { remaining: 1_000 } });
    mocks.resolveGotoUrls.mockResolvedValue(new Map());
  });

  it("saves the real page for a goto result, without Google's srsltid", async () => {
    mocks.getSnapshotsForRun.mockResolvedValue([
      gotoSnapshot(1),
      { ...gotoSnapshot(2), url: "https://example.com/direct" },
      { ...gotoSnapshot(3), position: null, url: null },
    ]);
    mocks.resolveGotoUrls.mockResolvedValue(
      new Map([[gotoUrl(1), "https://example.com/page?id=1&srsltid=abc"]]),
    );

    await runWorkflow({});

    expect(mocks.resolveGotoUrls).toHaveBeenCalledExactlyOnceWith([gotoUrl(1)]);
    expect(mocks.updateSnapshotUrls).toHaveBeenCalledExactlyOnceWith([
      { id: 1, url: "https://example.com/page?id=1" },
    ]);
  });

  it("keeps a goto link the converter can't resolve", async () => {
    mocks.getSnapshotsForRun.mockResolvedValue([gotoSnapshot(1)]);

    await runWorkflow({});

    expect(mocks.updateSnapshotUrls).toHaveBeenCalledExactlyOnceWith([]);
  });

  it("splits a large run across converter requests", async () => {
    mocks.getSnapshotsForRun.mockResolvedValue(
      [1, 2, 3].map((id) => gotoSnapshot(id)),
    );

    await runWorkflow({});

    expect(mocks.resolveGotoUrls.mock.calls).toEqual([
      [[gotoUrl(1), gotoUrl(2)]],
      [[gotoUrl(3)]],
    ]);
  });

  it("still finishes the run when the converter fails", async () => {
    mocks.getSnapshotsForRun.mockResolvedValue([gotoSnapshot(1)]);
    mocks.resolveGotoUrls.mockRejectedValue(new Error("converter down"));

    await runWorkflow({});

    expect(mocks.updateSnapshotUrls).not.toHaveBeenCalled();
    expect(mocks.updateRun).toHaveBeenCalledWith(
      "run_1",
      expect.objectContaining({ status: "completed", keywordsChecked: 1 }),
    );
  });
});
