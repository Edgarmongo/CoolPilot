import { describe, expect, it } from "vitest";
import type { AiBudgetSpend } from "./ai-budget";
import type { AiUsageLedgerEntry, AiUsageTokens } from "@/lib/types";
import { emptyAiUsageTokens } from "./ai-usage-ledger";
import {
  buildQualitySuggestions,
  qualitySuggestionSpendShare,
  summarizeCallQuality,
  summarizeContentAdoption,
  summarizeHumanEdits,
  summarizeQualityObjective,
  type QualityObjective,
  type QualitySuggestionInput,
} from "./quality-cost";

/**
 * CI-P7-04: the arithmetic of 质量与优化, asserted directly.
 *
 * What this file is for: the definitions. "首轮通过率" is pinned as *a call that sent one request and
 * it succeeded*, the objective is pinned as *attributed cost divided by adopted outputs*, and the
 * "not measurable" answers are pinned as `null` rather than 0. The HTTP contract is pinned in
 * `src/app/api/ai-cost-center/quality/route.test.ts`, and the tab's rendering is not asserted anywhere
 * (the repo has no DOM environment - the same split the budget tab lives with).
 */

function tokens(partial: Partial<AiUsageTokens>): AiUsageTokens {
  return { ...emptyAiUsageTokens(), ...partial };
}

function entry(partial: Partial<AiUsageLedgerEntry>): AiUsageLedgerEntry {
  return {
    id: partial.id ?? "u1",
    purpose: partial.purpose ?? "article",
    outcome: partial.outcome ?? "success",
    providerId: partial.providerId ?? "qwen",
    modelId: partial.modelId ?? "qwen-plus",
    endpointId: partial.endpointId ?? "ep1",
    credentialLabel: partial.credentialLabel ?? "****1234",
    budgetReservationId: partial.budgetReservationId ?? "",
    attemptIndex: partial.attemptIndex ?? 0,
    taskId: partial.taskId ?? "",
    runId: partial.runId ?? "",
    nodeId: partial.nodeId ?? "",
    parentUsageId: partial.parentUsageId ?? "",
    outputAssetId: partial.outputAssetId ?? "",
    contentItemId: partial.contentItemId ?? "",
    extensionId: partial.extensionId ?? "",
    meteredKind: partial.meteredKind ?? "text",
    tokens: partial.tokens ?? tokens({}),
    completeness: partial.completeness ?? "reported",
    quantityJson: partial.quantityJson ?? "{}",
    costAmount: partial.costAmount === undefined ? null : partial.costAmount,
    costCurrency: partial.costCurrency ?? "",
    costSource: partial.costSource ?? "computed",
    pricing: partial.pricing === undefined ? null : partial.pricing,
    durationMs: partial.durationMs ?? 0,
    errorSummary: partial.errorSummary ?? "",
    createdAt: partial.createdAt ?? 1_000,
  };
}

describe("summarizeCallQuality", () => {
  it("states no rate at all for a window that sent nothing", () => {
    const summary = summarizeCallQuality([]);
    expect(summary).toMatchObject({ calls: 0, requests: 0, retries: 0, requestsPerCall: null });
    // Every share is `null`: a window with no call did not pass 0% of anything.
    expect(summary.retryShare).toBeNull();
    expect(summary.singleRequestSuccessRate).toBeNull();
    expect(summary.firstRequestSuccessRate).toBeNull();
    expect(summary.attemptsByOutcome).toEqual({ success: 0, failed: 0, interrupted: 0 });
  });

  it("counts a one-request call as passed on the first request", () => {
    const summary = summarizeCallQuality([entry({ id: "a", createdAt: 1_100 })]);
    expect(summary).toMatchObject({ calls: 1, singleRequestSuccesses: 1, firstRequestSuccesses: 1, failedCalls: 0 });
    expect(summary.singleRequestSuccessRate).toBe(1);
    expect(summary.retryShare).toBe(0);
  });

  it("separates a retried success from a pass on the first request", () => {
    const summary = summarizeCallQuality([
      entry({ id: "a", outcome: "failed", createdAt: 1_100, tokens: tokens({ totalTokens: 10 }) }),
      entry({ id: "b", attemptIndex: 1, parentUsageId: "a", createdAt: 1_200, tokens: tokens({ totalTokens: 20 }) }),
    ]);
    // The call needed a retry, so neither rate counts it - and it is not a failed call either.
    expect(summary).toMatchObject({ calls: 1, requests: 2, retries: 1, singleRequestSuccesses: 0, failedCalls: 0 });
    expect(summary.singleRequestSuccessRate).toBe(0);
    expect(summary.firstRequestSuccessRate).toBe(0);
    expect(summary.retryShare).toBe(0.5);
    expect(summary.requestsPerCall).toBe(2);
    expect(summary.attemptsByOutcome).toEqual({ success: 1, failed: 1, interrupted: 0 });
  });

  it("shows a self-correction as a first-request pass that moved on", () => {
    const summary = summarizeCallQuality([
      entry({ id: "a", createdAt: 1_100 }),
      entry({ id: "b", outcome: "failed", attemptIndex: 1, parentUsageId: "a", createdAt: 1_200 }),
    ]);
    // The first request succeeded; the gap between the two rates is what 自纠 actually is here.
    expect(summary.firstRequestSuccesses).toBe(1);
    expect(summary.singleRequestSuccesses).toBe(0);
    // It is not a failed call: a request of it did succeed.
    expect(summary.failedCalls).toBe(0);
  });

  it("counts a call as failed when no request of it succeeded", () => {
    const summary = summarizeCallQuality([
      entry({ id: "a", outcome: "failed", createdAt: 1_100 }),
      entry({ id: "b", outcome: "interrupted", attemptIndex: 1, parentUsageId: "a", createdAt: 1_200 }),
    ]);
    expect(summary.failedCalls).toBe(1);
    expect(summary.attemptsByOutcome).toEqual({ success: 0, failed: 1, interrupted: 1 });
  });

  it("reports a retry whose predecessor is outside the window instead of classifying it", () => {
    const summary = summarizeCallQuality([
      entry({ id: "b", attemptIndex: 1, parentUsageId: "gone", createdAt: 1_200 }),
    ]);
    expect(summary.unresolvedPredecessorRequests).toBe(1);
    // It is still counted as its own call and as a retry: the count is not lost to the gap.
    expect(summary.calls).toBe(1);
    expect(summary.retries).toBe(1);
    // But it is not a pass on the first request: its first request was never read.
    expect(summary.singleRequestSuccesses).toBe(0);
    expect(summary.firstRequestSuccesses).toBe(0);
    expect(summary.singleRequestSuccessRate).toBe(0);
  });
});

/** A stored platform rendition, in the shape `readPlatformContentVersions` accepts. */
function rendition(partial: {
  platform?: string;
  source?: "derived" | "edited";
  createdAt?: number;
  updatedAt?: number;
}) {
  return {
    platform: partial.platform ?? "threads",
    title: "t",
    body: "b",
    imagePath: "",
    videoPath: "",
    source: partial.source ?? "derived",
    adaptations: [],
    baseFingerprint: "fp",
    createdAt: partial.createdAt ?? 1_000,
    updatedAt: partial.updatedAt ?? 1_000,
  };
}

function itemWith(versions: Record<string, Record<string, unknown>>) {
  return { metadata: { platformVersions: versions } };
}

const window = { from: 1_000, to: 2_000 };

describe("summarizeHumanEdits", () => {
  it("states no edit rate for a window with no rendition in it", () => {
    const summary = summarizeHumanEdits([], window);
    expect(summary).toMatchObject({ versions: 0, editedVersions: 0, derivedVersions: 0, editRate: null });
  });

  it("counts only the renditions whose own stamp falls inside the window", () => {
    const summary = summarizeHumanEdits(
      [
        itemWith({
          threads: rendition({ source: "edited", updatedAt: 1_500 }),
          xiaohongshu: rendition({ source: "derived", updatedAt: 900 }),
        }),
      ],
      window,
    );
    expect(summary).toMatchObject({ versions: 1, editedVersions: 1, derivedVersions: 0, editRate: 1 });
  });

  it("splits human rewrites from adapter output and never claims a magnitude", () => {
    const summary = summarizeHumanEdits(
      [
        itemWith({
          threads: rendition({ platform: "threads", source: "edited", updatedAt: 1_500 }),
          xiaohongshu: rendition({ platform: "xiaohongshu", source: "derived", updatedAt: 1_600 }),
          weibo: rendition({ platform: "weibo", source: "derived", updatedAt: 1_700 }),
        }),
      ],
      window,
    );
    expect(summary).toMatchObject({ versions: 3, editedVersions: 1, derivedVersions: 2 });
    expect(summary.editRate).toBeCloseTo(1 / 3, 6);
    // The card asks for 人工修改幅度; the workspace does not store one, and this says so in the type.
    expect(summary.magnitudeRecorded).toBe(false);
  });

  it("counts an unreadable entry rather than dropping it", () => {
    const summary = summarizeHumanEdits([itemWith({ threads: { body: "no shape at all" } })], window);
    expect(summary).toMatchObject({ versions: 0, unreadableVersions: 1 });
  });
});

describe("summarizeContentAdoption", () => {
  it("has no adoption rate to state when the window produced nothing", () => {
    const summary = summarizeContentAdoption({ draft: 0, ready: 0, posted: 0, failed: 0 });
    expect(summary).toMatchObject({ created: 0, adopted: 0, adoptionRate: null });
  });

  it("counts only the posted status as adopted", () => {
    const summary = summarizeContentAdoption({ draft: 3, ready: 2, posted: 1, failed: 4 });
    expect(summary).toMatchObject({ created: 10, adopted: 1 });
    expect(summary.adoptionRate).toBe(0.1);
  });
});

describe("summarizeQualityObjective", () => {
  const adopted = entry({
    id: "a",
    contentItemId: "c1",
    costAmount: 2,
    costCurrency: "CNY",
    tokens: tokens({ totalTokens: 1_000 }),
  });
  const other = entry({
    id: "b",
    contentItemId: "",
    costAmount: 3,
    costCurrency: "CNY",
    tokens: tokens({ totalTokens: 500 }),
  });

  it("divides the attributed cost by the adopted outputs, and shows the rest as unattributed", () => {
    const objective = summarizeQualityObjective({
      entries: [adopted, other],
      adoptedContentItemIds: ["c1"],
      adoptedOutputs: 2,
    });
    expect(objective.byCurrency).toEqual([
      { currency: "CNY", windowAmount: 5, attributedAmount: 2, costPerOutput: 1 },
    ]);
    // The money that named no adopted output is kept in its own list rather than dropped.
    expect(objective.unattributedByCurrency).toEqual([{ currency: "CNY", amount: 3, attempts: 1 }]);
    expect(objective).toMatchObject({ adoptedOutputs: 2, attributedOutputs: 1, costIsComplete: true });
    expect(objective.tokensPerOutput).toBe(750);
  });

  it("states no unit cost when the window adopted nothing", () => {
    const objective = summarizeQualityObjective({
      entries: [other],
      adoptedContentItemIds: [],
      adoptedOutputs: 0,
    });
    // `0` here would read as "free". There is nothing to divide by, so there is no unit cost.
    expect(objective.byCurrency[0].costPerOutput).toBeNull();
    expect(objective.tokensPerOutput).toBeNull();
  });

  it("keeps an unstated amount out of the total and marks the figure incomplete", () => {
    const objective = summarizeQualityObjective({
      entries: [
        adopted,
        entry({ id: "c", contentItemId: "", costAmount: null, costSource: "unpriced" }),
        entry({ id: "d", contentItemId: "", outcome: "failed", costAmount: null, costSource: "unknown" }),
      ],
      adoptedContentItemIds: ["c1"],
      adoptedOutputs: 1,
    });
    expect(objective.byCurrency[0]).toMatchObject({ windowAmount: 2, attributedAmount: 2, costPerOutput: 2 });
    expect(objective).toMatchObject({
      costIsComplete: false,
      unpricedRequests: 1,
      unmeasuredRequests: 1,
    });
  });

  it("reports a capped id list as a partial attribution rather than a smaller denominator", () => {
    const objective = summarizeQualityObjective({
      entries: [adopted],
      adoptedContentItemIds: ["c1"],
      adoptedOutputs: 40,
      attributionPartial: true,
    });
    expect(objective).toMatchObject({ adoptedOutputs: 40, attributedOutputs: 1, attributionPartial: true });
    expect(objective.byCurrency[0].costPerOutput).toBe(0.05);
  });

  it("never attributes a request that named no content item to an adopted output", () => {
    const objective = summarizeQualityObjective({
      entries: [entry({ id: "a", contentItemId: "", costAmount: 1, costCurrency: "CNY" })],
      // A set that happens to contain the empty string must not turn unnamed rows into an output.
      adoptedContentItemIds: [""],
      adoptedOutputs: 1,
    });
    expect(objective.byCurrency[0].attributedAmount).toBe(0);
    expect(objective.unattributedByCurrency).toEqual([{ currency: "CNY", amount: 1, attempts: 1 }]);
  });

  it("states nothing at all for an empty window", () => {
    const objective = summarizeQualityObjective({ entries: [], adoptedContentItemIds: [], adoptedOutputs: 0 });
    expect(objective).toMatchObject({ byCurrency: [], unattributedByCurrency: [], costIsComplete: false });
  });
});

// ---------------------------------------------------------------------------
// The suggestion rules (CI-P7-04-03)
// ---------------------------------------------------------------------------

function spend(partial: Partial<AiBudgetSpend> = {}): AiBudgetSpend {
  return {
    currency: "CNY",
    amount: 0,
    attempts: 0,
    statedAttempts: 0,
    unpricedAttempts: 0,
    unmeasuredAttempts: 0,
    otherCurrencyAttempts: 0,
    otherCurrencies: [],
    isComplete: true,
    truncated: false,
    from: 0,
    to: 0,
    ...partial,
  };
}

function objectiveWith(partial: Partial<QualityObjective> = {}): QualityObjective {
  return {
    adoptedOutputs: 0,
    attributedOutputs: 0,
    attributionPartial: false,
    totalTokens: 0,
    tokensPerOutput: null,
    byCurrency: [],
    unattributedByCurrency: [],
    costIsComplete: false,
    unpricedRequests: 0,
    unmeasuredRequests: 0,
    ...partial,
  };
}

function suggestionInput(partial: Partial<QualitySuggestionInput> = {}): QualitySuggestionInput {
  return {
    objective: objectiveWith(),
    calls: summarizeCallQuality([]),
    content: summarizeContentAdoption({ draft: 0, ready: 0, posted: 0, failed: 0 }),
    budget: {
      policy: "off",
      strategy: "balanced",
      monthlyLimit: null,
      currency: "CNY",
      spent: spend(),
    },
    ...partial,
  };
}

describe("buildQualitySuggestions - the apply-able rule", () => {
  it("suggests nothing when the window has nothing to say", () => {
    // An empty answer is a real answer: no rule may fire on data nobody read.
    expect(buildQualitySuggestions(suggestionInput())).toEqual([]);
  });

  it("offers the cost-saving tier once most of a stated limit is spent", () => {
    const suggestions = buildQualitySuggestions(
      suggestionInput({
        budget: {
          policy: "block",
          strategy: "balanced",
          monthlyLimit: 100,
          currency: "CNY",
          spent: spend({ amount: qualitySuggestionSpendShare * 100 }),
        },
      }),
    );
    expect(suggestions).toEqual([
      {
        id: "switch-to-cost-saving",
        action: { kind: "strategy", strategy: "cost-saving" },
        basis: {
          currency: "CNY",
          spentAmount: qualitySuggestionSpendShare * 100,
          limitAmount: 100,
          spentShare: qualitySuggestionSpendShare,
          strategy: "balanced",
        },
      },
    ]);
  });
});

describe("buildQualitySuggestions - the remaining rules", () => {
  it("stays quiet about the tier when it is already in force", () => {
    const suggestions = buildQualitySuggestions(
      suggestionInput({
        budget: {
          policy: "block",
          strategy: "cost-saving",
          monthlyLimit: 100,
          currency: "CNY",
          spent: spend({ amount: 99 }),
        },
      }),
    );
    expect(suggestions).toEqual([]);
  });

  it("needs a stated, non-zero limit before it can call the period nearly spent", () => {
    const spent = spend({ amount: 99 });
    // `block` without a limit: the gate compares nothing, so there is no "nearly" to report.
    expect(
      buildQualitySuggestions(
        suggestionInput({
          budget: { policy: "block", strategy: "balanced", monthlyLimit: null, currency: "CNY", spent },
        }),
      ),
    ).toEqual([]);
    // A limit of 0 is the "refuse everything" setting, not a nearly-spent period; nothing is divided
    // by it either.
    expect(
      buildQualitySuggestions(
        suggestionInput({
          budget: { policy: "block", strategy: "balanced", monthlyLimit: 0, currency: "CNY", spent },
        }),
      ),
    ).toEqual([]);
  });

  it("suggests the price catalog for unpriced requests, and never for unmeasured ones", () => {
    const unpriced = buildQualitySuggestions(suggestionInput({ objective: objectiveWith({ unpricedRequests: 4 }) }));
    expect(unpriced.map((suggestion) => suggestion.id)).toEqual(["record-prices"]);

    // A request that failed before usage was reported is not fixed by writing a price.
    expect(
      buildQualitySuggestions(suggestionInput({ objective: objectiveWith({ unmeasuredRequests: 4 }) })),
    ).toEqual([]);
  });

  it("suggests switching the gate on only when the window actually spent", () => {
    const suggestions = buildQualitySuggestions(
      suggestionInput({
        objective: objectiveWith({
          byCurrency: [{ currency: "CNY", windowAmount: 12, attributedAmount: 0, costPerOutput: null }],
        }),
      }),
    );
    expect(suggestions).toEqual([
      {
        id: "enable-budget",
        action: { kind: "link", target: "budget-tab" },
        basis: { currency: "CNY", windowAmount: 12, requests: 0 },
      },
    ]);
  });

  it("raises failed and retried calls with no setting behind them", () => {
    const calls = summarizeCallQuality([
      entry({ id: "a", outcome: "failed", createdAt: 1_100 }),
      entry({ id: "b", outcome: "failed", createdAt: 1_200 }),
    ]);
    const suggestions = buildQualitySuggestions(suggestionInput({ calls }));
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      id: "investigate-failed-calls",
      action: { kind: "none" },
      basis: { calls: 2, requests: 2, retries: 0, failedCalls: 2, singleRequestSuccessRate: 0 },
    });
  });

  it("raises adoption only below the share, and only when a rate could be measured", () => {
    const low = buildQualitySuggestions(
      suggestionInput({ content: summarizeContentAdoption({ draft: 9, ready: 0, posted: 1, failed: 0 }) }),
    );
    expect(low[0]).toMatchObject({ id: "review-adoption", basis: { created: 10, adopted: 1, adoptionRate: 0.1 } });

    const high = buildQualitySuggestions(
      suggestionInput({ content: summarizeContentAdoption({ draft: 1, ready: 0, posted: 9, failed: 0 }) }),
    );
    expect(high).toEqual([]);

    // Nothing produced is not "0% adopted": there is no rate, so nothing is raised.
    expect(buildQualitySuggestions(suggestionInput())).toEqual([]);
  });

  it("puts the actionable suggestion first", () => {
    const suggestions = buildQualitySuggestions(
      suggestionInput({
        objective: objectiveWith({ unpricedRequests: 2 }),
        calls: summarizeCallQuality([entry({ id: "a", outcome: "failed" })]),
        budget: {
          policy: "block",
          strategy: "balanced",
          monthlyLimit: 10,
          currency: "CNY",
          spent: spend({ amount: 10 }),
        },
      }),
    );
    expect(suggestions.map((suggestion) => suggestion.id)).toEqual([
      "switch-to-cost-saving",
      "record-prices",
      "investigate-failed-calls",
    ]);
  });
});
