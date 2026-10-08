import {
  usageRangeDays,
  type UsageModelSummary,
  type UsageRangeDays,
  type UsageRecord,
  type UsageSummary,
} from "@/lib/types";

export function isUsageRangeDays(value: number): value is UsageRangeDays {
  return (usageRangeDays as readonly number[]).includes(value);
}

export function normalizeUsageRange(value: unknown): UsageRangeDays {
  const numeric = Number(value);
  return isUsageRangeDays(numeric) ? numeric : usageRangeDays[0];
}

/**
 * Start-of-day timestamp of the oldest day in an inclusive `days`-long calendar window,
 * so "7 days" means today plus the previous 6 days.
 */
export function usageRangeStart(days: number, now = Date.now()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (Math.max(1, Math.floor(days)) - 1));
  return start.getTime();
}

/** Whitespace-insensitive character count ("字数") of a generated text. */
export function countTextCharacters(text: string) {
  return text.replace(/\s+/g, "").length;
}

function average(total: number, count: number) {
  return count > 0 ? Math.round(total / count) : 0;
}

function emptyModelSummary(provider: string, model: string): UsageModelSummary {
  return {
    provider,
    model,
    articles: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    wordCount: 0,
    avgWords: 0,
    avgTokens: 0,
  };
}

/**
 * Aggregates usage rows into the totals + per-model breakdown shown on the usage page.
 * Only successful generations are counted, matching the reference console note.
 */
export function summarizeUsageRecords(
  records: UsageRecord[],
  rangeDays: number,
  now = Date.now(),
): UsageSummary {
  const from = usageRangeStart(rangeDays, now);
  const to = now;

  const byModel = new Map<string, UsageModelSummary>();
  for (const record of records) {
    if (record.status !== "success") continue;
    if (record.createdAt < from || record.createdAt > to) continue;
    const key = `${record.provider}::${record.model}`;
    const summary = byModel.get(key) ?? emptyModelSummary(record.provider, record.model);
    summary.articles += 1;
    summary.inputTokens += record.inputTokens;
    summary.outputTokens += record.outputTokens;
    summary.totalTokens += record.totalTokens;
    summary.wordCount += record.wordCount;
    byModel.set(key, summary);
  }

  const models = Array.from(byModel.values())
    .map((summary) => ({
      ...summary,
      avgWords: average(summary.wordCount, summary.articles),
      avgTokens: average(summary.totalTokens, summary.articles),
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens || a.model.localeCompare(b.model));

  const totals = models.reduce(
    (acc, model) => ({
      articles: acc.articles + model.articles,
      inputTokens: acc.inputTokens + model.inputTokens,
      outputTokens: acc.outputTokens + model.outputTokens,
      totalTokens: acc.totalTokens + model.totalTokens,
      wordCount: acc.wordCount + model.wordCount,
    }),
    { articles: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, wordCount: 0 },
  );

  return {
    rangeDays,
    from,
    to,
    totals: {
      ...totals,
      avgWords: average(totals.wordCount, totals.articles),
      avgTokens: average(totals.totalTokens, totals.articles),
    },
    models,
  };
}
