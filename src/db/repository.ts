import { and, asc, desc, eq, gte, inArray, isNotNull, like, lte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { accountProfilePath } from "@/lib/paths";
import type {
  ContentItem,
  AgentChatMessageRecord,
  AgentChatMessageWithTools,
  AgentChatMode,
  AgentChatRole,
  AgentChatThreadRecord,
  AgentCreditType,
  AgentEventType,
  AgentToolCallRecord,
  AgentToolStatus,
  AgentRuntimeEventRecord,
  AgentRuntimeRecord,
  AgentRunStatus,
  MetricSource,
  MetricStatus,
  PlaybookId,
  PublishRecord,
  PublishRecordStatus,
  RunEventRecord,
  RunRecord,
  RunStatus,
  ScheduleRecord,
  ScheduleTime,
  AccountPlatform,
  AccountRecord,
  AccountStatus,
  UsageRecord,
  UsageRecordStatus,
  UsageSummary,
  AiModelPrice,
  AiUsageCompleteness,
  AiUsageCostSource,
  AiUsageLedgerEntry,
  AiUsageLedgerSummary,
  AiUsageMeteredKind,
  AiUsageOutcome,
  AiUsagePricingBasis,
  AiUsageTokens,
  AiUsageUnitLabel,
  AiBudgetDecisionGate,
  AiBudgetDecisionRecord,
  AiBudgetDecisionStatus,
  AiBudgetReconciliation,
  AiBudgetReconciliationLedger,
  AiBudgetReconciliationRow,
  AiBudgetReconciliationVerdict,
  AiBudgetReservation,
  AiBudgetReservationStatus,
} from "@/lib/types";
import { aiUsageKindIsTokenMetered, aiUsageKindUnits } from "@/lib/types";
import { AppError } from "@/lib/app-errors";
import { db, ensureDatabase, sqlite } from "./client";
import {
  agentRuntimeEvents,
  agentRuntimeRuns,
  aiBudgetDecisions,
  aiBudgetReservations,
  aiModelPrices,
  aiUsageLedger,
  chatMessages,
  chatThreads,
  chatToolCalls,
  contentItems,
  publishRecords,
  runEvents,
  runs,
  schedules,
  accounts,
  usageRecords,
} from "./schema";
import { deriveContentImageAssociations } from "@/lib/content-image-reconciliation";
import { contentImageList, mergeContentMetadata } from "@/lib/content-images";
import {
  contentImageAssetsKey,
  mergeContentImageAssets,
  toStoredImageReference,
} from "@/lib/content-image-assets";
import { summarizeUsageRecords, usageRangeStart } from "@/lib/usage";
import { normalizeUsageTokens, summarizeAiUsageLedger } from "@/lib/ai-usage-ledger";
import { aiBudgetRecordRetentionMs, roundAmount, type AiBudgetDecision, type AiBudgetSpend } from "@/lib/ai-budget";

export const DEFAULT_AGENT_CHAT_THREAD_ID = "default-accounts-agent-thread";

function now() {
  return Date.now();
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toAccount(row: typeof accounts.$inferSelect): AccountRecord {
  return {
    id: row.id,
    name: row.name,
    platform: row.platform as AccountPlatform,
    url: row.url,
    account: row.account,
    // `row.profilePath` is history - where this account's browser profile lived in the
    // workspace that created it (P5-B0-1.5). Consumers launch Chromium on this field, so it
    // is resolved from the open workspace instead of the stored absolute path.
    profilePath: accountProfilePath(row.id),
    memo: row.memo,
    status: row.status as AccountStatus,
    preset: parseJson<Record<string, unknown>>(row.presetJson, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toContent(row: typeof contentItems.$inferSelect): ContentItem {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    postReadyText: row.postReadyText,
    sourceUrls: parseJson<string[]>(row.sourceUrlsJson, []),
    imagePath: row.imagePath || undefined,
    metadata: parseJson<Record<string, unknown>>(row.metadataJson, {}),
    status: row.status as ContentItem["status"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSchedule(row: typeof schedules.$inferSelect): ScheduleRecord {
  return {
    id: row.id,
    playbookId: row.playbookId as PlaybookId,
    accountId: row.accountId ?? undefined,
    enabled: row.enabled,
    scheduleTimes: parseJson<ScheduleTime[]>(row.scheduleTimesJson, []),
    params: parseJson<Record<string, unknown>>(row.paramsJson, {}),
    status: row.status as ScheduleRecord["status"],
    contentItemId: row.contentItemId ?? undefined,
    publishAuthorized: row.publishAuthorized,
    lastRunAt: row.lastRunAt ?? undefined,
    nextRunAt: row.nextRunAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRun(row: typeof runs.$inferSelect): RunRecord {
  return {
    id: row.id,
    playbookId: row.playbookId as PlaybookId,
    accountId: row.accountId ?? undefined,
    scheduleId: row.scheduleId ?? undefined,
    scheduledFor: row.scheduledFor ?? undefined,
    status: row.status as RunStatus,
    params: parseJson<Record<string, unknown>>(row.paramsJson, {}),
    resultMessage: row.resultMessage,
    artifactPath: row.artifactPath || undefined,
    createdAt: row.createdAt,
    startedAt: row.startedAt ?? undefined,
    finishedAt: row.finishedAt ?? undefined,
    updatedAt: row.updatedAt,
  };
}

function toRunEvent(row: typeof runEvents.$inferSelect): RunEventRecord {
  return {
    id: row.id,
    runId: row.runId,
    level: row.level as RunEventRecord["level"],
    message: row.message,
    data: parseJson<Record<string, unknown>>(row.dataJson, {}),
    createdAt: row.createdAt,
  };
}

function toPublishRecord(row: typeof publishRecords.$inferSelect): PublishRecord {
  return {
    id: row.id,
    accountId: row.accountId ?? undefined,
    accountName: row.accountName,
    platform: row.platform,
    title: row.title,
    contentType: row.contentType,
    status: row.status as PublishRecordStatus,
    url: row.url,
    method: row.method,
    terminal: row.terminal,
    message: row.message,
    contentItemId: row.contentItemId ?? undefined,
    publishedAt: row.publishedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    views: row.views,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    favorites: row.favorites,
    followsDelta: row.followsDelta,
    completionRate: row.completionRate ?? undefined,
    metricStatus: row.metricStatus as MetricStatus,
    metricsSyncedAt: row.metricsSyncedAt ?? undefined,
    metricsSource: row.metricsSource ? (row.metricsSource as MetricSource) : undefined,
  };
}

function toUsageRecord(row: typeof usageRecords.$inferSelect): UsageRecord {
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    kind: row.kind,
    status: row.status as UsageRecordStatus,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    totalTokens: row.totalTokens,
    wordCount: row.wordCount,
    accountId: row.accountId ?? undefined,
    contentItemId: row.contentItemId ?? undefined,
    createdAt: row.createdAt,
  };
}

function toChatThread(row: typeof chatThreads.$inferSelect): AgentChatThreadRecord {
  return {
    id: row.id,
    title: row.title,
    activeAccountId: row.activeAccountId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toChatMessage(row: typeof chatMessages.$inferSelect): AgentChatMessageRecord {
  return {
    id: row.id,
    threadId: row.threadId,
    role: row.role as AgentChatRole,
    content: row.content,
    accountId: row.accountId ?? undefined,
    mode: row.mode ? (row.mode as AgentChatMode) : undefined,
    metadata: parseJson<Record<string, unknown>>(row.metadataJson, {}),
    createdAt: row.createdAt,
  };
}

function toToolCall(row: typeof chatToolCalls.$inferSelect): AgentToolCallRecord {
  return {
    id: row.id,
    threadId: row.threadId,
    messageId: row.messageId,
    name: row.name,
    status: row.status as AgentToolStatus,
    accountId: row.accountId ?? undefined,
    input: parseJson<Record<string, unknown>>(row.inputJson, {}),
    output: parseJson<Record<string, unknown>>(row.outputJson, {}),
    creditType: row.creditType ? (row.creditType as AgentCreditType) : undefined,
    creditCost: row.creditCost ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAgentRuntimeRun(row: typeof agentRuntimeRuns.$inferSelect): AgentRuntimeRecord {
  return {
    id: row.id,
    threadId: row.threadId ?? undefined,
    accountId: row.accountId ?? undefined,
    status: row.status as AgentRunStatus,
    mode: row.mode as "local",
    input: parseJson<Record<string, unknown>>(row.inputJson, {}),
    state: parseJson<Record<string, unknown>>(row.stateJson, {}),
    pendingApproval: parseJson<Record<string, unknown>>(row.pendingApprovalJson, {}),
    result: parseJson<Record<string, unknown>>(row.resultJson, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAgentRuntimeEvent(row: typeof agentRuntimeEvents.$inferSelect): AgentRuntimeEventRecord {
  return {
    id: row.id,
    agentRunId: row.agentRunId,
    type: row.type as AgentEventType,
    message: row.message,
    data: parseJson<Record<string, unknown>>(row.dataJson, {}),
    createdAt: row.createdAt,
  };
}

export async function listAccounts() {
  await ensureDatabase();
  return (await db.select().from(accounts).orderBy(desc(accounts.updatedAt))).map(toAccount);
}

export async function getAccount(id: string) {
  await ensureDatabase();
  const [row] = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  return row ? toAccount(row) : null;
}

export async function createAccount(input: {
  name: string;
  platform: AccountPlatform;
  url?: string;
  account?: string;
  memo?: string;
  status?: AccountStatus;
  preset?: Record<string, unknown>;
}) {
  await ensureDatabase();
  const id = nanoid();
  const createdAt = now();
  const profilePath = accountProfilePath(id);
  await db.insert(accounts).values({
    id,
    name: input.name,
    platform: input.platform,
    url: input.url ?? "",
    account: input.account ?? "",
    memo: input.memo ?? "",
    status: input.status ?? "needs_login",
    presetJson: JSON.stringify(input.preset ?? {}),
    profilePath,
    createdAt,
    updatedAt: createdAt,
  });
  return getAccount(id);
}

export async function updateAccount(id: string, patch: Partial<Omit<AccountRecord, "id" | "createdAt">>) {
  await ensureDatabase();
  const { preset, ...rest } = patch;
  // `profilePath` carries `accounts.profile_path`, history from the workspace this account
  // was created in, and reads resolve the live path from the open workspace instead
  // (P5-B0-1.5). It is therefore not writable: an edit that accepted it would plant the
  // absolute path this build stopped trusting, on a machine that may not be this one.
  delete rest.profilePath;
  await db
    .update(accounts)
    .set({
      ...rest,
      presetJson: preset ? JSON.stringify(preset) : undefined,
      updatedAt: now(),
    })
    .where(eq(accounts.id, id));
  return getAccount(id);
}

export async function deleteAccount(id: string) {
  await ensureDatabase();
  await db.delete(accounts).where(eq(accounts.id, id));
}

export async function getContentItem(id: string) {
  await ensureDatabase();
  const [row] = await db.select().from(contentItems).where(eq(contentItems.id, id)).limit(1);
  return row ? toContent(row) : null;
}

/**
 * Read-only bulk lookup (CI-P2-04): the lifecycle reader and the calendar resolve the content items
 * their plans and records name, and both need them by id rather than by page. Ids that no longer
 * exist are simply absent from the answer - the caller decides how to report that.
 */
export async function listContentItemRefs(ids: string[]) {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return [] as ContentItem[];
  await ensureDatabase();
  const rows = await db.select().from(contentItems).where(inArray(contentItems.id, unique));
  return rows.map(toContent);
}

const contentStatuses = ["draft", "ready", "posted", "failed"] as const;

export async function listContentItems(filter: {
  query?: string;
  from?: number;
  to?: number;
  type?: string;
  status?: string;
  page?: number;
  pageSize?: number;
} = {}) {
  await ensureDatabase();
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(20, Math.max(1, filter.pageSize ?? 20));
  const type = filter.type && /^[a-z0-9-]+$/i.test(filter.type) ? filter.type : "";
  const status = filter.status && (contentStatuses as readonly string[]).includes(filter.status) ? filter.status : "";
  const conditions = [
    filter.query ? like(sql`lower(${contentItems.title})`, `%${filter.query.toLowerCase()}%`) : undefined,
    typeof filter.from === "number" ? gte(contentItems.createdAt, filter.from) : undefined,
    typeof filter.to === "number" ? lte(contentItems.createdAt, filter.to) : undefined,
    // Content items store their kind inside the metadata JSON blob.
    type ? like(contentItems.metadataJson, `%"type":"${type}"%`) : undefined,
    status ? eq(contentItems.status, status) : undefined,
  ].filter(Boolean);
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }] = where
    ? await db.select({ total: sql<number>`count(*)` }).from(contentItems).where(where)
    : await db.select({ total: sql<number>`count(*)` }).from(contentItems);
  const totalItems = Number(total);
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);
  const query = db
    .select()
    .from(contentItems)
    .orderBy(desc(contentItems.createdAt))
    .limit(pageSize)
    .offset((safePage - 1) * pageSize);
  const rows = where ? await query.where(where) : await query;
  return {
    items: rows.map(toContent),
    total: totalItems,
    page: safePage,
    pageSize,
    totalPages,
  };
}

export async function createContentItem(input: {
  title: string;
  body: string;
  postReadyText: string;
  sourceUrls?: string[];
  imagePath?: string;
  metadata?: Record<string, unknown>;
  status?: ContentItem["status"];
}) {
  await ensureDatabase();
  const createdAt = now();
  const id = nanoid();
  await db.insert(contentItems).values({
    id,
    title: input.title,
    body: input.body,
    postReadyText: input.postReadyText,
    sourceUrlsJson: JSON.stringify(input.sourceUrls ?? []),
    imagePath: input.imagePath ?? "",
    metadataJson: JSON.stringify(input.metadata ?? {}),
    status: input.status ?? "ready",
    createdAt,
    updatedAt: createdAt,
  });
  const [row] = await db.select().from(contentItems).where(eq(contentItems.id, id)).limit(1);
  return toContent(row);
}

export async function updateContentItemImage(input: {
  itemId: string;
  imagePath: string;
  imagePrompt?: string;
  provider?: string;
  model?: string;
}) {
  await ensureDatabase();
  const current = await getContentItem(input.itemId);
  if (!current || !input.imagePath.trim()) return current;
  // C4: the image a caller generated for this item arrives as a local path and is stored as the single
  // shape the item holds (a file name), never as the path of the machine that produced it.
  const cover = toStoredImageReference(input.imagePath);
  // The generated image becomes the cover, so it must lead the image list too.
  const images = [
    cover,
    ...contentImageList(current)
      .map(toStoredImageReference)
      .filter((entry) => entry !== cover),
  ].slice(0, 12);
  const metadata = {
    ...current.metadata,
    images,
    // C4: this writer is the one that knows the model, so it records it per image (identity, origin and
    // model for the file it just made) instead of leaving the item with a bare list of names. The flat
    // `imageProvider`/`imageModel` keys below stay: readers from before C4 use them.
    [contentImageAssetsKey]: mergeContentImageAssets(current.metadata?.[contentImageAssetsKey], images, {
      [cover]: { provider: input.provider, model: input.model },
    }),
    ...(input.imagePrompt ? { imagePrompt: input.imagePrompt } : {}),
    ...(input.provider ? { imageProvider: input.provider } : {}),
    ...(input.model ? { imageModel: input.model } : {}),
  };
  await db.update(contentItems).set({
    imagePath: cover,
    metadataJson: JSON.stringify(metadata),
    updatedAt: now(),
  }).where(eq(contentItems.id, input.itemId));
  return getContentItem(input.itemId);
}

export async function findNextReadyContentItem() {
  await ensureDatabase();
  const [row] = await db
    .select()
    .from(contentItems)
    .where(eq(contentItems.status, "ready"))
    .orderBy(asc(contentItems.createdAt))
    .limit(1);
  return row ? toContent(row) : null;
}

export async function markContentItemPosted(itemId: string) {
  await ensureDatabase();
  await db
    .update(contentItems)
    .set({ status: "posted", updatedAt: now() })
    .where(eq(contentItems.id, itemId));
  return getContentItem(itemId);
}

/** Updates the editable fields of a content item. Undefined fields are left untouched. */
export async function updateContentItem(
  id: string,
  patch: {
    title?: string;
    body?: string;
    postReadyText?: string;
    imagePath?: string;
    images?: string[];
    metadata?: Record<string, unknown>;
    status?: ContentItem["status"];
  },
) {
  await ensureDatabase();
  const current = await getContentItem(id);
  if (!current) return null;
  const metadata = mergeContentMetadata(current.metadata, { images: patch.images, metadata: patch.metadata });
  await db
    .update(contentItems)
    .set({
      title: patch.title,
      body: patch.body,
      postReadyText: patch.postReadyText,
      imagePath: patch.imagePath,
      metadataJson: JSON.stringify(metadata),
      status: patch.status,
      updatedAt: now(),
    })
    .where(eq(contentItems.id, id));
  return getContentItem(id);
}

export async function deleteContentItem(id: string) {
  await ensureDatabase();
  await db.delete(contentItems).where(eq(contentItems.id, id));
}

export async function reconcileContentImagesFromChatHistory() {
  await ensureDatabase();
  const toolRows = await db.select().from(chatToolCalls).orderBy(asc(chatToolCalls.createdAt));
  let repaired = 0;
  const associations = deriveContentImageAssociations(toolRows.map((row) => ({
    threadId: row.threadId,
    name: row.name,
    status: row.status,
    output: parseJson<Record<string, unknown>>(row.outputJson, {}),
  })));
  for (const association of associations) {
    const current = await getContentItem(association.itemId);
    if (current && !current.imagePath) {
      await updateContentItemImage(association);
      repaired += 1;
    }
  }

  return repaired;
}

export async function listSchedules() {
  await ensureDatabase();
  return (await db.select().from(schedules).orderBy(desc(schedules.updatedAt))).map(toSchedule);
}

export async function getSchedule(id: string) {
  await ensureDatabase();
  const [row] = await db.select().from(schedules).where(eq(schedules.id, id)).limit(1);
  return row ? toSchedule(row) : null;
}

export async function createSchedule(input: {
  playbookId: PlaybookId;
  accountId?: string;
  enabled: boolean;
  scheduleTimes: ScheduleTime[];
  params?: Record<string, unknown>;
  nextRunAt?: number;
  status?: ScheduleRecord["status"];
  contentItemId?: string;
  publishAuthorized?: boolean;
}) {
  await ensureDatabase();
  const createdAt = now();
  const id = nanoid();
  await db.insert(schedules).values({
    id,
    playbookId: input.playbookId,
    accountId: input.accountId,
    enabled: input.enabled,
    scheduleTimesJson: JSON.stringify(input.scheduleTimes),
    paramsJson: JSON.stringify(input.params ?? {}),
    status: input.status ?? "scheduled",
    contentItemId: input.contentItemId,
    publishAuthorized: input.publishAuthorized ?? false,
    nextRunAt: input.nextRunAt,
    createdAt,
    updatedAt: createdAt,
  });
  return getSchedule(id);
}

export async function updateSchedule(id: string, patch: Partial<ScheduleRecord>) {
  await ensureDatabase();
  await db
    .update(schedules)
    .set({
      playbookId: patch.playbookId,
      accountId: patch.accountId,
      enabled: patch.enabled,
      scheduleTimesJson: patch.scheduleTimes ? JSON.stringify(patch.scheduleTimes) : undefined,
      paramsJson: patch.params ? JSON.stringify(patch.params) : undefined,
      status: patch.status,
      contentItemId: patch.contentItemId,
      publishAuthorized: patch.publishAuthorized,
      lastRunAt: patch.lastRunAt,
      nextRunAt: patch.nextRunAt,
      updatedAt: now(),
    })
    .where(eq(schedules.id, id));
  return getSchedule(id);
}

export async function dueSchedules(timestamp = now()) {
  await ensureDatabase();
  return (
    await db
      .select()
      .from(schedules)
      .where(and(eq(schedules.enabled, true), isNotNull(schedules.nextRunAt), lte(schedules.nextRunAt, timestamp)))
  ).map(toSchedule);
}

export async function listRuns(limit = 20) {
  await ensureDatabase();
  return (await db.select().from(runs).orderBy(desc(runs.createdAt)).limit(limit)).map(toRun);
}

export async function getRun(id: string) {
  await ensureDatabase();
  const [row] = await db.select().from(runs).where(eq(runs.id, id)).limit(1);
  return row ? toRun(row) : null;
}

export async function createRun(input: {
  playbookId: PlaybookId;
  accountId?: string;
  scheduleId?: string;
  scheduledFor?: number;
  params?: Record<string, unknown>;
}) {
  await ensureDatabase();
  const createdAt = now();
  const id = nanoid();
  await db.insert(runs).values({
    id,
    playbookId: input.playbookId,
    accountId: input.accountId,
    scheduleId: input.scheduleId,
    scheduledFor: input.scheduledFor,
    paramsJson: JSON.stringify(input.params ?? {}),
    status: "queued",
    createdAt,
    updatedAt: createdAt,
  });
  await appendRunEvent(id, "Run queued", "info");
  return getRun(id);
}

export async function updateRunStatus(
  id: string,
  status: RunStatus,
  resultMessage = "",
  artifactPath = "",
) {
  await ensureDatabase();
  const timestamp = now();
  await db
    .update(runs)
    .set({
      status,
      resultMessage,
      artifactPath,
      startedAt: status === "running" ? timestamp : undefined,
      finishedAt: ["success", "warning", "failed", "cancelled"].includes(status) ? timestamp : undefined,
      updatedAt: timestamp,
    })
    .where(eq(runs.id, id));
  return getRun(id);
}

/**
 * CI-P7-03-B. Writes a pause: the run status that means "not finished, nothing in flight".
 *
 * `updateRunStatus` cannot express it. That function only ever *sets* `finished_at` (for the terminal
 * literals) and leaves it alone otherwise, which is right for every other status - but a pause can be
 * reached from a run whose own step had already stamped it. `research_extraction` writes `failed` inside
 * its task before the budget refusal gets back to the runner, so a pause there has to say "this run is not
 * finished" out loud. Doing it here rather than by adding `"paused"` to that list keeps the two meanings
 * apart: the terminal list is about *setting* a timestamp, and this is about *clearing* one.
 *
 * `started_at` and `artifact_path` are left alone: the run did start, and a pause is not a step backwards.
 * The message lands in `result_message`, where the queue reads it.
 */
export async function markRunPaused(id: string, resultMessage: string) {
  await ensureDatabase();
  const timestamp = now();
  await db
    .update(runs)
    .set({ status: "paused", resultMessage, finishedAt: null, updatedAt: timestamp })
    .where(eq(runs.id, id));
  return getRun(id);
}

export async function claimNextQueuedRun() {
  await ensureDatabase();
  const [row] = await db
    .select()
    .from(runs)
    .where(eq(runs.status, "queued"))
    .orderBy(asc(runs.createdAt))
    .limit(1);
  if (!row) {
    return null;
  }
  await updateRunStatus(row.id, "running");
  return getRun(row.id);
}

export async function appendRunEvent(
  runId: string,
  message: string,
  level: RunEventRecord["level"] = "info",
  data?: Record<string, unknown>,
) {
  await ensureDatabase();
  const row = {
    id: nanoid(),
    runId,
    level,
    message,
    dataJson: JSON.stringify(data ?? {}),
    createdAt: now(),
  };
  await db.insert(runEvents).values(row);
  return toRunEvent(row);
}

export async function listRunEvents(runId: string, after = 0) {
  await ensureDatabase();
  const rows = await db
    .select()
    .from(runEvents)
    .where(eq(runEvents.runId, runId))
    .orderBy(asc(runEvents.createdAt));
  return rows.map(toRunEvent).filter((event) => event.createdAt > after);
}

export async function getOrCreateDefaultAgentThread(activeAccountId?: string) {
  await ensureDatabase();
  const [existing] = await db
    .select()
    .from(chatThreads)
    .where(eq(chatThreads.id, DEFAULT_AGENT_CHAT_THREAD_ID))
    .limit(1);

  const timestamp = now();
  if (!existing) {
    await db.insert(chatThreads).values({
      id: DEFAULT_AGENT_CHAT_THREAD_ID,
      title: "Sites Agent",
      activeAccountId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const [created] = await db
      .select()
      .from(chatThreads)
      .where(eq(chatThreads.id, DEFAULT_AGENT_CHAT_THREAD_ID))
      .limit(1);
    return toChatThread(created);
  }

  if (activeAccountId && existing.activeAccountId !== activeAccountId) {
    await db
      .update(chatThreads)
      .set({ activeAccountId, updatedAt: timestamp })
      .where(eq(chatThreads.id, DEFAULT_AGENT_CHAT_THREAD_ID));
    return {
      ...toChatThread(existing),
      activeAccountId,
      updatedAt: timestamp,
    };
  }

  return toChatThread(existing);
}

export async function createAgentChatThread(input: { title?: string; activeAccountId?: string } = {}) {
  await ensureDatabase();
  const timestamp = now();
  const row = {
    id: nanoid(),
    title: input.title ?? "Chat",
    activeAccountId: input.activeAccountId ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db.insert(chatThreads).values(row);
  return toChatThread(row);
}

export async function listAgentChatThreads(input: { limit?: number } = {}) {
  await ensureDatabase();
  const query = db.select().from(chatThreads).orderBy(desc(chatThreads.updatedAt));
  if (input.limit) {
    return (await query.limit(input.limit)).map(toChatThread);
  }
  return (await query).map(toChatThread);
}

export async function getAgentChatThread(threadId: string, activeAccountId?: string) {
  await ensureDatabase();
  if (threadId === DEFAULT_AGENT_CHAT_THREAD_ID) {
    return getOrCreateDefaultAgentThread(activeAccountId);
  }
  const [existing] = await db.select().from(chatThreads).where(eq(chatThreads.id, threadId)).limit(1);
  if (!existing) {
    return null;
  }
  if (activeAccountId && existing.activeAccountId !== activeAccountId) {
    const updatedAt = now();
    await db.update(chatThreads).set({ activeAccountId, updatedAt }).where(eq(chatThreads.id, threadId));
    return { ...toChatThread(existing), activeAccountId, updatedAt };
  }
  return toChatThread(existing);
}

export async function updateAgentChatThreadTitle(threadId: string, title: string) {
  await ensureDatabase();
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return getAgentChatThread(threadId);
  const updatedAt = now();
  await db
    .update(chatThreads)
    .set({ title: trimmedTitle, updatedAt })
    .where(eq(chatThreads.id, threadId));
  return getAgentChatThread(threadId);
}

export async function listAgentChatMessages(threadId = DEFAULT_AGENT_CHAT_THREAD_ID): Promise<AgentChatMessageWithTools[]> {
  await ensureDatabase();
  if (threadId === DEFAULT_AGENT_CHAT_THREAD_ID) {
    await getOrCreateDefaultAgentThread();
  }

  const [messageRows, toolRows] = await Promise.all([
    db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.threadId, threadId))
      .orderBy(asc(chatMessages.createdAt)),
    db
      .select()
      .from(chatToolCalls)
      .where(eq(chatToolCalls.threadId, threadId))
      .orderBy(asc(chatToolCalls.createdAt)),
  ]);

  const toolsByMessageId = new Map<string, AgentToolCallRecord[]>();
  for (const row of toolRows) {
    const tool = toToolCall(row);
    toolsByMessageId.set(tool.messageId, [...(toolsByMessageId.get(tool.messageId) ?? []), tool]);
  }

  return messageRows.map((row) => ({
    ...toChatMessage(row),
    toolCalls: toolsByMessageId.get(row.id) ?? [],
  }));
}

export async function createAgentChatMessage(input: {
  threadId?: string;
  role: AgentChatRole;
  content: string;
  accountId?: string;
  mode?: AgentChatMode;
  metadata?: Record<string, unknown>;
}) {
  await ensureDatabase();
  const thread = input.threadId
    ? await getAgentChatThread(input.threadId, input.accountId)
    : await getOrCreateDefaultAgentThread(input.accountId);
  if (!thread) throw new Error("Chat thread not found");
  const createdAt = now();
  const row = {
    id: nanoid(),
    threadId: input.threadId ?? thread.id,
    role: input.role,
    content: input.content,
    accountId: input.accountId,
    mode: input.mode,
    metadataJson: JSON.stringify(input.metadata ?? {}),
    createdAt,
  };
  await db.insert(chatMessages).values(row);
  await db
    .update(chatThreads)
    .set({ activeAccountId: input.accountId ?? thread.activeAccountId, updatedAt: createdAt })
    .where(eq(chatThreads.id, row.threadId));
  const [created] = await db.select().from(chatMessages).where(eq(chatMessages.id, row.id)).limit(1);
  return toChatMessage(created);
}

export async function createAgentToolCall(input: {
  threadId?: string;
  messageId: string;
  name: string;
  status?: AgentToolStatus;
  accountId?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  creditType?: AgentCreditType;
  creditCost?: number;
}) {
  await ensureDatabase();
  const thread = input.threadId
    ? await getAgentChatThread(input.threadId, input.accountId)
    : await getOrCreateDefaultAgentThread(input.accountId);
  if (!thread) throw new Error("Chat thread not found");
  const createdAt = now();
  const row = {
    id: nanoid(),
    threadId: input.threadId ?? thread.id,
    messageId: input.messageId,
    name: input.name,
    status: input.status ?? "pending",
    accountId: input.accountId,
    inputJson: JSON.stringify(input.input ?? {}),
    outputJson: JSON.stringify(input.output ?? {}),
    creditType: input.creditType,
    creditCost: input.creditCost,
    createdAt,
    updatedAt: createdAt,
  };
  await db.insert(chatToolCalls).values(row);
  const [created] = await db.select().from(chatToolCalls).where(eq(chatToolCalls.id, row.id)).limit(1);
  return toToolCall(created);
}

export async function getAgentToolCall(id: string) {
  await ensureDatabase();
  const [row] = await db.select().from(chatToolCalls).where(eq(chatToolCalls.id, id)).limit(1);
  return row ? toToolCall(row) : null;
}

export async function updateAgentToolCall(
  id: string,
  patch: {
    status?: AgentToolStatus;
    output?: Record<string, unknown>;
    creditType?: AgentCreditType;
    creditCost?: number;
  },
) {
  await ensureDatabase();
  const updatedAt = now();
  await db
    .update(chatToolCalls)
    .set({
      status: patch.status,
      outputJson: patch.output ? JSON.stringify(patch.output) : undefined,
      creditType: patch.creditType,
      creditCost: patch.creditCost,
      updatedAt,
    })
    .where(eq(chatToolCalls.id, id));

  const [row] = await db.select().from(chatToolCalls).where(eq(chatToolCalls.id, id)).limit(1);
  return row ? toToolCall(row) : null;
}

export async function createAgentRuntimeRun(input: {
  threadId?: string;
  accountId?: string;
  mode?: "local";
  status?: AgentRunStatus;
  input?: Record<string, unknown>;
  state?: Record<string, unknown>;
}) {
  await ensureDatabase();
  const createdAt = now();
  const row = {
    id: nanoid(),
    threadId: input.threadId ?? null,
    accountId: input.accountId ?? null,
    status: input.status ?? "queued",
    mode: input.mode ?? "local",
    inputJson: JSON.stringify(input.input ?? {}),
    stateJson: JSON.stringify(input.state ?? {}),
    pendingApprovalJson: "{}",
    resultJson: "{}",
    createdAt,
    updatedAt: createdAt,
  };
  await db.insert(agentRuntimeRuns).values(row);
  return toAgentRuntimeRun(row);
}

export async function getAgentRuntimeRun(id: string) {
  await ensureDatabase();
  const [row] = await db.select().from(agentRuntimeRuns).where(eq(agentRuntimeRuns.id, id)).limit(1);
  return row ? toAgentRuntimeRun(row) : null;
}

/**
 * CI-P1-02: the unified task view has to read agent executions the same way it reads `listRuns` and
 * `listSchedules`, and until now this table had a `get` but no `list`. Read-only, newest first, and
 * the same shape as its two siblings - no column, no status and no writer changed.
 */
export async function listAgentRuntimeRuns(limit = 100) {
  await ensureDatabase();
  return (await db
    .select()
    .from(agentRuntimeRuns)
    .orderBy(desc(agentRuntimeRuns.createdAt))
    .limit(limit)).map(toAgentRuntimeRun);
}

export async function updateAgentRuntimeRun(
  id: string,
  patch: {
    status?: AgentRunStatus;
    state?: Record<string, unknown>;
    pendingApproval?: Record<string, unknown>;
    result?: Record<string, unknown>;
  },
) {
  await ensureDatabase();
  await db
    .update(agentRuntimeRuns)
    .set({
      status: patch.status,
      stateJson: patch.state ? JSON.stringify(patch.state) : undefined,
      pendingApprovalJson: patch.pendingApproval ? JSON.stringify(patch.pendingApproval) : undefined,
      resultJson: patch.result ? JSON.stringify(patch.result) : undefined,
      updatedAt: now(),
    })
    .where(eq(agentRuntimeRuns.id, id));
  return getAgentRuntimeRun(id);
}

export async function appendAgentRuntimeEvent(input: {
  agentRunId: string;
  type: AgentEventType;
  message?: string;
  data?: Record<string, unknown>;
}) {
  await ensureDatabase();
  const row = {
    id: nanoid(),
    agentRunId: input.agentRunId,
    type: input.type,
    message: input.message ?? "",
    dataJson: JSON.stringify(input.data ?? {}),
    createdAt: now(),
  };
  await db.insert(agentRuntimeEvents).values(row);
  return toAgentRuntimeEvent(row);
}

export async function listAgentRuntimeEvents(agentRunId: string, after = 0) {
  await ensureDatabase();
  const rows = await db
    .select()
    .from(agentRuntimeEvents)
    .where(eq(agentRuntimeEvents.agentRunId, agentRunId))
    .orderBy(asc(agentRuntimeEvents.createdAt));
  return rows.map(toAgentRuntimeEvent).filter((event) => event.createdAt > after);
}

export async function listPublishRecords(limit = 200) {
  await ensureDatabase();
  const rows = await db.select().from(publishRecords).orderBy(desc(publishRecords.createdAt)).limit(limit);
  return rows.map(toPublishRecord);
}

export async function getPublishRecord(id: string) {
  await ensureDatabase();
  const [row] = await db.select().from(publishRecords).where(eq(publishRecords.id, id)).limit(1);
  return row ? toPublishRecord(row) : null;
}

export async function createPublishRecord(input: {
  accountId?: string;
  accountName?: string;
  platform?: string;
  title?: string;
  contentType?: string;
  status?: PublishRecordStatus;
  url?: string;
  method?: string;
  terminal?: string;
  message?: string;
  contentItemId?: string;
  publishedAt?: number;
}) {
  await ensureDatabase();
  const createdAt = now();
  const id = nanoid();
  await db.insert(publishRecords).values({
    id,
    accountId: input.accountId,
    accountName: input.accountName ?? "",
    platform: input.platform ?? "",
    title: input.title ?? "",
    contentType: input.contentType ?? "",
    status: input.status ?? "queued",
    url: input.url ?? "",
    method: input.method ?? "",
    terminal: input.terminal ?? "",
    message: input.message ?? "",
    contentItemId: input.contentItemId,
    publishedAt: input.publishedAt,
    createdAt,
    updatedAt: createdAt,
  });
  return getPublishRecord(id);
}

export async function updatePublishRecord(
  id: string,
  patch: Partial<Pick<PublishRecord, "status" | "url" | "message" | "publishedAt">>,
) {
  await ensureDatabase();
  await db
    .update(publishRecords)
    .set({
      status: patch.status,
      url: patch.url,
      message: patch.message,
      publishedAt: patch.publishedAt,
      updatedAt: now(),
    })
    .where(eq(publishRecords.id, id));
  return getPublishRecord(id);
}

export async function deletePublishRecord(id: string) {
  await ensureDatabase();
  await db.delete(publishRecords).where(eq(publishRecords.id, id));
}

export async function getUsageRecord(id: string) {
  await ensureDatabase();
  const [row] = await db.select().from(usageRecords).where(eq(usageRecords.id, id)).limit(1);
  return row ? toUsageRecord(row) : null;
}

export async function listUsageRecords(filter: { from?: number; to?: number; limit?: number } = {}) {
  await ensureDatabase();
  const limit = Math.min(Math.max(1, Math.floor(filter.limit ?? 500)), 5000);
  const conditions = [];
  if (filter.from !== undefined) conditions.push(gte(usageRecords.createdAt, filter.from));
  if (filter.to !== undefined) conditions.push(lte(usageRecords.createdAt, filter.to));
  const rows = await db
    .select()
    .from(usageRecords)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(usageRecords.createdAt))
    .limit(limit);
  return rows.map(toUsageRecord);
}

export async function createUsageRecord(input: {
  provider?: string;
  model?: string;
  kind?: string;
  status?: UsageRecordStatus;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  wordCount?: number;
  accountId?: string;
  contentItemId?: string;
  createdAt?: number;
}) {
  await ensureDatabase();
  const id = nanoid();
  const inputTokens = Math.max(0, Math.round(input.inputTokens ?? 0));
  const outputTokens = Math.max(0, Math.round(input.outputTokens ?? 0));
  await db.insert(usageRecords).values({
    id,
    provider: input.provider ?? "",
    model: input.model ?? "",
    kind: input.kind ?? "article",
    status: input.status ?? "success",
    inputTokens,
    outputTokens,
    totalTokens: Math.max(0, Math.round(input.totalTokens ?? inputTokens + outputTokens)),
    wordCount: Math.max(0, Math.round(input.wordCount ?? 0)),
    accountId: input.accountId,
    contentItemId: input.contentItemId,
    createdAt: input.createdAt ?? now(),
  });
  return getUsageRecord(id);
}

export async function deleteUsageRecord(id: string) {
  await ensureDatabase();
  await db.delete(usageRecords).where(eq(usageRecords.id, id));
}

export async function summarizeUsage(rangeDays: number): Promise<UsageSummary> {
  const from = usageRangeStart(rangeDays);
  const records = await listUsageRecords({ from, limit: 5000 });
  return summarizeUsageRecords(records, rangeDays);
}

// ---------------------------------------------------------------------------
// AI usage ledger (CI-P7-01)
// ---------------------------------------------------------------------------

function toAiUsageLedgerEntry(row: typeof aiUsageLedger.$inferSelect): AiUsageLedgerEntry {
  return {
    id: row.id,
    purpose: row.purpose,
    outcome: row.outcome as AiUsageOutcome,
    providerId: row.providerId,
    modelId: row.modelId,
    endpointId: row.endpointId,
    credentialLabel: row.credentialLabel,
    attemptIndex: row.attemptIndex,
    taskId: row.taskId,
    runId: row.runId,
    nodeId: row.nodeId,
    parentUsageId: row.parentUsageId,
    outputAssetId: row.outputAssetId,
    contentItemId: row.contentItemId,
    extensionId: row.extensionId,
    budgetReservationId: row.budgetReservationId,
    meteredKind: row.meteredKind as AiUsageMeteredKind,
    tokens: {
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.totalTokens,
      cachedInputTokens: row.cachedInputTokens,
      reasoningTokens: row.reasoningTokens,
    },
    completeness: row.completeness as AiUsageCompleteness,
    quantityJson: row.quantityJson,
    // `null` in, `null` out: a missing figure never becomes 0 on the way through the mapper.
    costAmount: row.costAmount ?? null,
    costCurrency: row.costCurrency,
    costSource: row.costSource as AiUsageCostSource,
    pricing: parseJson<AiUsagePricingBasis | null>(row.pricingJson, null),
    durationMs: row.durationMs,
    errorSummary: row.errorSummary,
    createdAt: row.createdAt,
  };
}

function toAiModelPrice(row: typeof aiModelPrices.$inferSelect): AiModelPrice {
  return {
    id: row.id,
    providerId: row.providerId,
    modelId: row.modelId,
    meteredKind: row.meteredKind as AiUsageMeteredKind,
    currency: row.currency,
    inputPerMillion: row.inputPerMillion,
    outputPerMillion: row.outputPerMillion,
    cachedInputPerMillion: row.cachedInputPerMillion ?? undefined,
    // `null` in, `undefined` out: "this row prices no per-unit dimension" is an absence, not a 0.
    unitPrice: row.unitPrice ?? undefined,
    unitLabel: (row.unitLabel ?? "") as AiUsageUnitLabel | "",
    declaredFree: row.declaredFree,
    priceVersion: row.priceVersion,
    source: row.source,
    effectiveFrom: row.effectiveFrom,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

export async function createAiUsageLedgerEntry(input: {
  purpose: string;
  outcome?: AiUsageOutcome;
  providerId?: string;
  modelId?: string;
  endpointId?: string;
  credentialLabel?: string;
  attemptIndex?: number;
  taskId?: string;
  runId?: string;
  nodeId?: string;
  parentUsageId?: string;
  outputAssetId?: string;
  contentItemId?: string;
  /**
   * The Marketplace extension this request ran as (CI-P7-05-03), empty when it ran as none.
   *
   * It is an id the *storefront* can name (see `@/lib/marketplace-attribution`), not a label for
   * the kind of work: a purpose is already that, and a row that said `article` here would make
   * "which extension spent this" unanswerable.
   */
  extensionId?: string;
  /** The budget hold this request was admitted under (CI-P7-03-A); empty when it was not gated. */
  budgetReservationId?: string;
  meteredKind?: AiUsageMeteredKind;
  tokens?: Partial<AiUsageTokens>;
  completeness?: AiUsageCompleteness;
  quantity?: Record<string, unknown>;
  costAmount?: number | null;
  costCurrency?: string;
  costSource?: AiUsageCostSource;
  pricing?: AiUsagePricingBasis | null;
  durationMs?: number;
  errorSummary?: string;
  createdAt?: number;
}) {
  await ensureDatabase();
  const id = nanoid();
  const tokens = normalizeUsageTokens(input.tokens);
  const costAmount =
    input.costAmount === undefined || input.costAmount === null ? null : Number(input.costAmount);
  // The one rule this writer refuses to let a caller break: a row with no figure must say so.
  // Storing `computed` next to a null amount would make the summary read it as a measured
  // failure instead of an unpriced call, which is a different statement about the same call.
  const costSource: AiUsageCostSource =
    costAmount === null
      ? input.costSource === "unpriced"
        ? "unpriced"
        : "unknown"
      : (input.costSource ?? "computed");

  await db.insert(aiUsageLedger).values({
    id,
    purpose: input.purpose,
    outcome: input.outcome ?? "success",
    providerId: input.providerId ?? "",
    modelId: input.modelId ?? "",
    endpointId: input.endpointId ?? "",
    credentialLabel: input.credentialLabel ?? "",
    attemptIndex: Math.max(0, Math.round(input.attemptIndex ?? 0)),
    taskId: input.taskId ?? "",
    runId: input.runId ?? "",
    nodeId: input.nodeId ?? "",
    parentUsageId: input.parentUsageId ?? "",
    outputAssetId: input.outputAssetId ?? "",
    contentItemId: input.contentItemId ?? "",
    extensionId: input.extensionId ?? "",
    budgetReservationId: input.budgetReservationId ?? "",
    meteredKind: input.meteredKind ?? "text",
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    totalTokens: tokens.totalTokens,
    cachedInputTokens: tokens.cachedInputTokens,
    reasoningTokens: tokens.reasoningTokens,
    completeness: input.completeness ?? "unknown",
    quantityJson: JSON.stringify(input.quantity ?? {}),
    costAmount,
    costCurrency: costAmount === null ? "" : (input.costCurrency ?? ""),
    costSource,
    pricingJson: JSON.stringify(input.pricing ?? null),
    durationMs: Math.max(0, Math.round(input.durationMs ?? 0)),
    errorSummary: input.errorSummary ?? "",
    createdAt: input.createdAt ?? now(),
  });
  return getAiUsageLedgerEntry(id);
}

export async function getAiUsageLedgerEntry(id: string) {
  await ensureDatabase();
  const [row] = await db.select().from(aiUsageLedger).where(eq(aiUsageLedger.id, id)).limit(1);
  return row ? toAiUsageLedgerEntry(row) : null;
}

export async function listAiUsageLedgerEntries(
  filter: { from?: number; to?: number; taskId?: string; contentItemId?: string; limit?: number } = {},
) {
  await ensureDatabase();
  const limit = Math.min(Math.max(1, Math.floor(filter.limit ?? 500)), 5000);
  const conditions = [];
  if (filter.from !== undefined) conditions.push(gte(aiUsageLedger.createdAt, filter.from));
  if (filter.to !== undefined) conditions.push(lte(aiUsageLedger.createdAt, filter.to));
  if (filter.taskId) conditions.push(eq(aiUsageLedger.taskId, filter.taskId));
  if (filter.contentItemId) conditions.push(eq(aiUsageLedger.contentItemId, filter.contentItemId));
  const rows = await db
    .select()
    .from(aiUsageLedger)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(aiUsageLedger.createdAt))
    .limit(limit);
  return rows.map(toAiUsageLedgerEntry);
}

/**
 * The ledger's overview figures for a `rangeDays` window, using the same calendar rule the
 * 用量统计 page uses (`usageRangeStart`), so the two pages can never disagree about which days
 * "最近 7 天" means.
 */
export async function summarizeAiUsageLedgerRange(rangeDays: number): Promise<AiUsageLedgerSummary> {
  const from = usageRangeStart(rangeDays);
  const entries = await listAiUsageLedgerEntries({ from, limit: 5000 });
  return summarizeAiUsageLedger(entries, { from, to: now() });
}

/** One row of the price catalog as it is handed over. A field left out is a field not stated. */
export type AiModelPriceInput = {
  providerId: string;
  modelId?: string;
  meteredKind?: AiUsageMeteredKind;
  currency?: string;
  inputPerMillion?: number;
  outputPerMillion?: number;
  cachedInputPerMillion?: number | null;
  unitPrice?: number | null;
  unitLabel?: AiUsageUnitLabel | "";
  declaredFree?: boolean;
  priceVersion?: string;
  source?: string;
  effectiveFrom?: number;
  notes?: string;
  createdAt?: number;
};

function refusePrice(message: string, details: Record<string, unknown>) {
  return new AppError("AI_PRICE_INVALID", { status: 400, message, details });
}

function assertRate(value: number | undefined | null, label: string) {
  if (value === undefined || value === null) return;
  if (!Number.isFinite(value) || value < 0) {
    throw refusePrice(`${label} must be a finite, non-negative number.`, { label, value });
  }
}

/**
 * A price row has to describe the dimension it claims, and it may not turn a blank into a free
 * (CI-P7-01-05).
 *
 * The shape rules live here rather than only at the API boundary, because this is the function
 * every writer goes through - including a future bill import that has no form to validate. Field
 * *format* rules (which currency codes exist, how long a version may be) belong to the zod schema
 * at the boundary instead, so the two cannot drift into disagreeing copies of one rule.
 *
 * The default this replaced - "no price given, so 0" - is what made a half-filled row claim a free
 * model. A missing rate is refused now, and a row whose rates are genuinely all zero says so.
 */
function assertPriceShape(input: AiModelPriceInput, meteredKind: AiUsageMeteredKind) {
  const units = aiUsageKindUnits[meteredKind];
  assertRate(input.inputPerMillion, "inputPerMillion");
  assertRate(input.outputPerMillion, "outputPerMillion");
  assertRate(input.cachedInputPerMillion, "cachedInputPerMillion");
  assertRate(input.unitPrice, "unitPrice");

  if (aiUsageKindIsTokenMetered(meteredKind)) {
    if (input.unitPrice !== undefined && input.unitPrice !== null) {
      throw refusePrice(`A ${meteredKind} price is billed per million tokens and cannot carry a unit price.`, {
        meteredKind,
      });
    }
    if (input.unitLabel) {
      throw refusePrice(`A ${meteredKind} price is billed per million tokens and names no unit.`, {
        meteredKind,
        unitLabel: input.unitLabel,
      });
    }
    if (input.inputPerMillion === undefined || input.outputPerMillion === undefined) {
      throw refusePrice(
        `A ${meteredKind} price must state both its input and its output rate; a rate nobody stated is not 0.`,
        { meteredKind },
      );
    }
    const allZero =
      input.inputPerMillion === 0 && input.outputPerMillion === 0 && !(input.cachedInputPerMillion ?? 0);
    if (allZero && !input.declaredFree) {
      throw refusePrice(
        "Every rate on this row is 0. A free model has to be declared as free instead of left blank.",
        { meteredKind, declaredFree: false },
      );
    }
    return;
  }

  const unitLabel = input.unitLabel ?? "";
  if (!units.includes(unitLabel as AiUsageUnitLabel)) {
    throw refusePrice(
      `A ${meteredKind} price must name the unit it is billed in (${units.join(" or ")}).`,
      { meteredKind, unitLabel },
    );
  }
  if (input.unitPrice === undefined || input.unitPrice === null) {
    throw refusePrice(`A ${meteredKind} price must state its price per ${unitLabel}.`, { meteredKind, unitLabel });
  }
  if (input.unitPrice === 0 && !input.declaredFree) {
    throw refusePrice("A price of 0 has to be declared as free instead of being left unstated.", {
      meteredKind,
      unitLabel,
      declaredFree: false,
    });
  }
  // A row prices one dimension. Token rates on a per-image row would be inert numbers nobody
  // should be able to read as "and also 2 per million tokens".
  if (input.inputPerMillion || input.outputPerMillion || input.cachedInputPerMillion) {
    throw refusePrice(
      `A ${meteredKind} price is billed per ${unitLabel}, not per token; leave the token rates out.`,
      { meteredKind, unitLabel },
    );
  }
}

/** Every message in an error chain: Drizzle wraps the driver's error, which holds the real one. */
function errorChainMessages(error: unknown) {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth += 1) {
    if (!(current instanceof Error)) {
      messages.push(String(current));
      break;
    }
    messages.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  return messages.join(" | ");
}

/**
 * The key collision, said in business terms.
 *
 * SQLite's own message names columns ("UNIQUE constraint failed:
 * ai_model_prices.provider_id, …"), not the situation - and the situation is one the user can act
 * on: that provider, model and dimension already has a price in force from that instant, and the
 * catalog keeps history by adding a later instant rather than by overwriting an earlier one.
 *
 * The message is read through the whole cause chain, because Drizzle wraps the driver's error
 * ("Failed query: insert into …") and the phrase this looks for is one level down.
 */
function priceWriteError(
  error: unknown,
  input: AiModelPriceInput,
  meteredKind: AiUsageMeteredKind,
  effectiveFrom: number,
) {
  if (!/UNIQUE constraint failed/i.test(errorChainMessages(error))) return error;
  return new AppError("AI_PRICE_CONFLICT", {
    status: 409,
    message: "A price for this provider, model and dimension is already in force from that instant.",
    details: {
      providerId: input.providerId,
      modelId: input.modelId ?? "*",
      meteredKind,
      effectiveFrom,
    },
  });
}

/**
 * Adds one price to the catalog. This never edits a row: a price change is a new row with a later
 * `effective_from`, which is what keeps "what did that call cost in March" answerable from the
 * ledger's own frozen snapshots.
 */
export async function createAiModelPrice(input: AiModelPriceInput) {
  await ensureDatabase();
  const meteredKind = input.meteredKind ?? "text";
  const effectiveFrom = input.effectiveFrom ?? now();
  assertPriceShape(input, meteredKind);

  const id = nanoid();
  try {
    await db.insert(aiModelPrices).values({
      id,
      providerId: input.providerId,
      modelId: input.modelId ?? "*",
      meteredKind,
      currency: input.currency ?? "CNY",
      inputPerMillion: input.inputPerMillion ?? 0,
      outputPerMillion: input.outputPerMillion ?? 0,
      // `undefined`/`null` means "the provider does not price this separately", and NULL is how that
      // is stored; 0 would claim it is free.
      cachedInputPerMillion: input.cachedInputPerMillion ?? null,
      unitPrice: input.unitPrice ?? null,
      unitLabel: input.unitLabel ?? "",
      declaredFree: input.declaredFree ?? false,
      priceVersion: input.priceVersion ?? "",
      source: input.source ?? "manual",
      effectiveFrom,
      notes: input.notes ?? "",
      createdAt: input.createdAt ?? now(),
    });
  } catch (error) {
    throw priceWriteError(error, input, meteredKind, effectiveFrom);
  }
  const [row] = await db.select().from(aiModelPrices).where(eq(aiModelPrices.id, id)).limit(1);
  return row ? toAiModelPrice(row) : null;
}

export async function listAiModelPrices(filter: { providerId?: string; meteredKind?: AiUsageMeteredKind } = {}) {
  await ensureDatabase();
  const conditions = [];
  if (filter.providerId) conditions.push(eq(aiModelPrices.providerId, filter.providerId));
  if (filter.meteredKind) conditions.push(eq(aiModelPrices.meteredKind, filter.meteredKind));
  const rows = await db
    .select()
    .from(aiModelPrices)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(aiModelPrices.effectiveFrom));
  return rows.map(toAiModelPrice);
}

/**
 * The price to cost a call with, or `null` when the catalog has nothing to say.
 *
 * `null` is a real answer and the caller must keep it: it is what makes the ledger row `unpriced`
 * instead of a zero the user would read as "this call was free".
 *
 * `meteredKind` is a required argument rather than a defaulted one (CI-P7-01-05): a text price must
 * never be what costs an image, and a caller that could leave the dimension out would be able to
 * reintroduce exactly that bug by writing a shorter argument list. The compiler asks for it here
 * instead of the bill being wrong later.
 *
 * An exact model row always beats the provider's `*` row, whatever their `effective_from` dates
 * are - a catch-all price added later must not shadow the specific one it was meant to back up -
 * and within one tier the newest row already in force wins.
 */
export async function resolveModelPrice(
  providerId: string,
  modelId: string,
  at = now(),
  meteredKind: AiUsageMeteredKind = "text",
) {
  if (!providerId) return null;
  await ensureDatabase();
  const candidates = await db
    .select()
    .from(aiModelPrices)
    .where(
      and(
        eq(aiModelPrices.providerId, providerId),
        eq(aiModelPrices.meteredKind, meteredKind),
        lte(aiModelPrices.effectiveFrom, at),
        inArray(aiModelPrices.modelId, modelId ? [modelId, "*"] : ["*"]),
      ),
    )
    .orderBy(desc(aiModelPrices.effectiveFrom));
  const exact = modelId ? candidates.find((row) => row.modelId === modelId) : undefined;
  const fallback = candidates.find((row) => row.modelId === "*");
  const row = exact ?? fallback;
  return row ? toAiModelPrice(row) : null;
}

// ---------------------------------------------------------------------------
// CI-P7-03-A: the budget holds, the decisions, and the reconciliation
// ---------------------------------------------------------------------------

/**
 * The period's own ledger rows, added up **by the database**.
 *
 * Why this exists instead of reading rows and adding them in JavaScript (which is what CI-P7-03
 * shipped): the admission of a call has to be one indivisible step - read what is spent, read what is
 * held, write the hold - and only the database can do that in one statement. If the number the hold is
 * compared against came from a `SELECT` the caller had already read, a second process could commit
 * between the read and the write and both would pass.
 *
 * The arithmetic is the *same* rule as `summarizeBudgetSpend`: the money is the rows stated in this
 * currency, a row that states no figure makes the total a floor and is counted by why, and a row
 * billed in another currency is never subtracted from this one. `src/db/repositories/ai-budget.test.ts`
 * holds the two to each other on the same rows, so they cannot drift apart quietly.
 *
 * One difference is real and is a correction, not a shortcut: an aggregate cannot hit a row ceiling,
 * so `truncated` is always false here. The old read stopped at 5000 rows and reported the month as a
 * floor; the database is asked for the sum, which is the sum whatever the month's size.
 */
export async function readAiBudgetSpend(input: {
  start: number;
  end: number;
  currency: string;
}): Promise<AiBudgetSpend> {
  await ensureDatabase();
  const answer = await sqlite.execute({
    sql: `SELECT
            COALESCE(SUM(CASE WHEN cost_amount IS NOT NULL AND cost_currency = ? THEN cost_amount ELSE 0 END), 0) AS amount,
            COUNT(*) AS attempts,
            COALESCE(SUM(CASE WHEN cost_amount IS NOT NULL AND cost_currency = ? THEN 1 ELSE 0 END), 0) AS stated_attempts,
            COALESCE(SUM(CASE WHEN cost_amount IS NULL AND cost_source = 'unpriced' THEN 1 ELSE 0 END), 0) AS unpriced_attempts,
            COALESCE(SUM(CASE WHEN cost_amount IS NULL AND cost_source <> 'unpriced' THEN 1 ELSE 0 END), 0) AS unmeasured_attempts,
            COALESCE(SUM(CASE WHEN cost_amount IS NOT NULL AND cost_currency <> ? THEN 1 ELSE 0 END), 0) AS other_currency_attempts,
            COALESCE(GROUP_CONCAT(DISTINCT CASE WHEN cost_amount IS NOT NULL AND cost_currency <> ? THEN cost_currency END), '') AS other_currencies
          FROM ai_usage_ledger
          WHERE created_at >= ? AND created_at < ?`,
    // The half-open window `[start, end)` is written as `>= start AND < end`: `budgetPeriodOf`'s end
    // is the next period's first instant, so a row stamped exactly there belongs to the next month.
    args: [input.currency, input.currency, input.currency, input.currency, input.start, input.end],
  });
  const row = answer.rows[0] ?? {};
  const number = (value: unknown) => Number(value ?? 0);
  const unpricedAttempts = number(row.unpriced_attempts);
  const unmeasuredAttempts = number(row.unmeasured_attempts);
  const otherCurrencyAttempts = number(row.other_currency_attempts);
  const otherCurrencies = String(row.other_currencies ?? "")
    .split(",")
    .map((currency) => currency.trim())
    .filter(Boolean)
    .sort();
  return {
    currency: input.currency,
    amount: roundAmount(number(row.amount)),
    attempts: number(row.attempts),
    statedAttempts: number(row.stated_attempts),
    unpricedAttempts,
    unmeasuredAttempts,
    otherCurrencyAttempts,
    otherCurrencies: [...new Set(otherCurrencies)],
    isComplete: unpricedAttempts === 0 && unmeasuredAttempts === 0 && otherCurrencyAttempts === 0,
    // An aggregate has no row ceiling to hit - see the note above.
    truncated: false,
    from: input.start,
    to: input.end - 1,
  };
}

/**
 * What the period's **live** holds add up to, and how many there are.
 *
 * `expires_at > at` rather than `status = 'held'`: a hold whose TTL passed stops counting from that
 * instant whether or not anything has reaped it yet, so a crash can never hold budget for longer than
 * the TTL even if no sweep ever runs. A settled or reaped row is excluded because its money is either
 * back or was never spent.
 */
export async function readAiBudgetHolds(input: { periodKey: string; currency: string; at: number }) {
  await ensureDatabase();
  const answer = await sqlite.execute({
    sql: `SELECT COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS total
          FROM ai_budget_reservations
          WHERE status = 'held' AND period_key = ? AND currency = ? AND expires_at > ?`,
    args: [input.periodKey, input.currency, input.at],
  });
  const row = answer.rows[0] ?? {};
  return { amount: roundAmount(Number(row.amount ?? 0)), count: Number(row.total ?? 0) };
}

/**
 * Everything a budget decision is made of, read from the shared database: the period's spending and
 * the holds every process is currently holding.
 */
export async function readAiBudgetPeriodState(input: {
  periodKey: string;
  periodStart: number;
  periodEnd: number;
  currency: string;
  at: number;
}) {
  const spent = await readAiBudgetSpend({ start: input.periodStart, end: input.periodEnd, currency: input.currency });
  const holds = await readAiBudgetHolds({ periodKey: input.periodKey, currency: input.currency, at: input.at });
  return { spent, reserved: holds.amount, heldCount: holds.count };
}

/** Everything the hold needs to record itself. The verdict's own arithmetic is not repeated here. */
export interface ReserveAiBudgetHoldInput {
  periodKey: string;
  periodStart: number;
  periodEnd: number;
  currency: string;
  /** The ceiling to hold - `aiBudgetReservationAmount(estimate)`. Never 0: those hold nothing. */
  amount: number;
  /**
   * True when the policy may refuse: the statement then only inserts while
   * `spent + held + amount <= limit`. False under `warn`, where a refusal is impossible by definition
   * and the hold is taken unconditionally - the number on the page still has to be true.
   */
  enforce: boolean;
  limit: number;
  policy: string;
  estimateKind: string;
  estimateMethod: string;
  purpose: string;
  meteredKind: AiUsageMeteredKind;
  providerId: string;
  modelId: string;
  routeResolved: boolean;
  runId?: string;
  nodeId?: string;
  taskId?: string;
  contentItemId?: string;
  owner: string;
  at: number;
  expiresAt: number;
}

/**
 * Takes a budget hold **if the period still has room**, as one statement.
 *
 * This is the whole reason the holds moved into the database. The condition and the write are the
 * same statement, so SQLite evaluates them under one write lock: two processes (or two requests of
 * one process) that race here are ordered by the database, and the second one sees the first one's
 * row. There is no window between "read what is spent" and "write the hold" for a caller to slip
 * through - which is exactly what an in-memory `Map` could never promise.
 *
 * `granted: false` is a *decision* - the arithmetic said no - and is deliberately not an error: the
 * caller turns it into the same 402 the pure evaluation produces. A statement that could not run at
 * all throws instead, because "the database is broken" must never be reported as "over budget".
 */
export async function reserveAiBudgetHold(input: ReserveAiBudgetHoldInput) {
  await ensureDatabase();
  const id = nanoid();
  const answer = await sqlite.execute({
    sql: `INSERT INTO ai_budget_reservations (
            id, period_key, period_start, period_end, currency, amount, policy, estimate_kind,
            estimate_method, purpose, metered_kind, provider_id, model_id, route_resolved, run_id,
            node_id, task_id, content_item_id, owner, status, settle_kind, created_at, expires_at,
            settled_at, updated_at
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'held', '', ?, ?, NULL, ?
          WHERE ? = 0 OR (
            (SELECT COALESCE(SUM(cost_amount), 0) FROM ai_usage_ledger
              WHERE created_at >= ? AND created_at < ?
                AND cost_amount IS NOT NULL AND cost_currency = ?)
            + (SELECT COALESCE(SUM(amount), 0) FROM ai_budget_reservations
              WHERE status = 'held' AND period_key = ? AND currency = ? AND expires_at > ?)
            + ?
          ) <= ?`,
    args: [
      id,
      input.periodKey,
      input.periodStart,
      input.periodEnd,
      input.currency,
      roundAmount(input.amount),
      input.policy,
      input.estimateKind,
      input.estimateMethod,
      input.purpose,
      input.meteredKind,
      input.providerId,
      input.modelId,
      input.routeResolved ? 1 : 0,
      input.runId ?? "",
      input.nodeId ?? "",
      input.taskId ?? "",
      input.contentItemId ?? "",
      input.owner,
      input.at,
      input.expiresAt,
      input.at,
      input.enforce ? 1 : 0,
      input.periodStart,
      input.periodEnd,
      input.currency,
      input.periodKey,
      input.currency,
      input.at,
      roundAmount(input.amount),
      input.limit,
    ],
  });
  const granted = Number(answer.rowsAffected ?? 0) === 1;
  return { granted, reservation: granted ? await getAiBudgetReservation(id) : null };
}

function toAiBudgetReservation(row: typeof aiBudgetReservations.$inferSelect): AiBudgetReservation {
  return {
    id: row.id,
    periodKey: row.periodKey,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    currency: row.currency,
    amount: row.amount,
    policy: row.policy,
    estimateKind: row.estimateKind,
    estimateMethod: row.estimateMethod,
    purpose: row.purpose,
    meteredKind: row.meteredKind as AiUsageMeteredKind,
    providerId: row.providerId,
    modelId: row.modelId,
    routeResolved: row.routeResolved,
    runId: row.runId,
    nodeId: row.nodeId,
    taskId: row.taskId,
    contentItemId: row.contentItemId,
    owner: row.owner,
    status: row.status as AiBudgetReservationStatus,
    settleKind: row.settleKind,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    settledAt: row.settledAt ?? null,
    updatedAt: row.updatedAt,
  };
}

export async function getAiBudgetReservation(id: string) {
  await ensureDatabase();
  const [row] = await db.select().from(aiBudgetReservations).where(eq(aiBudgetReservations.id, id)).limit(1);
  return row ? toAiBudgetReservation(row) : null;
}

/**
 * Gives a hold back - **at most once**, whichever process asks.
 *
 * The `WHERE status = 'held'` is the idempotency: the first caller changes the row, every later one
 * changes nothing and is told so (`settled: false`). That is what makes a `finally` that runs twice,
 * a retried request, or two processes settling the same hold all harmless - and it is why the caller
 * does not have to invent a settlement key: the hold's own id is the key, and it exists once.
 *
 * What this does **not** do is write a cost. The hold is a ceiling; what the call spent is the ledger
 * row's own figure, linked by its `budgetReservationId`. Merging the two here would be a second,
 * silently different opinion about one call's cost.
 */
export async function settleAiBudgetReservation(input: { id: string; at: number; kind: string }) {
  await ensureDatabase();
  const answer = await sqlite.execute({
    sql: `UPDATE ai_budget_reservations
          SET status = 'settled', settle_kind = ?, settled_at = ?, updated_at = ?
          WHERE id = ? AND status = 'held'`,
    args: [input.kind, input.at, input.at, input.id],
  });
  const settled = Number(answer.rowsAffected ?? 0) === 1;
  return { settled, reservation: await getAiBudgetReservation(input.id) };
}

/**
 * Reaps the holds whose TTL passed, and drops the audit trail past its retention.
 *
 * Reaping is bookkeeping, not enforcement: a hold stops counting from the instant `expires_at`
 * passes whether or not this ran (every read filters on it). Marking the row is what makes the audit
 * say *why* a hold stopped counting, and it is what a restarted process's first gated call does for
 * the holds a dead process left behind.
 *
 * The retention delete is bounded and deliberate: one hold per gated call is a lot of rows over a
 * year, and a local-first database lives on the user's disk. Only rows that are no longer `held` are
 * ever deleted - a live hold is never pruned, whatever its age.
 */
export async function sweepAiBudgetReservations(at: number) {
  await ensureDatabase();
  const expired = await sqlite.execute({
    sql: `UPDATE ai_budget_reservations
          SET status = 'expired', settle_kind = 'expired', settled_at = ?, updated_at = ?
          WHERE status = 'held' AND expires_at <= ?`,
    args: [at, at, at],
  });
  const retentionBefore = at - aiBudgetRecordRetentionMs;
  const prunedReservations = await sqlite.execute({
    sql: `DELETE FROM ai_budget_reservations WHERE status <> 'held' AND created_at < ?`,
    args: [retentionBefore],
  });
  const prunedDecisions = await sqlite.execute({
    sql: `DELETE FROM ai_budget_decisions WHERE at < ?`,
    args: [retentionBefore],
  });
  return {
    expired: Number(expired.rowsAffected ?? 0),
    prunedReservations: Number(prunedReservations.rowsAffected ?? 0),
    prunedDecisions: Number(prunedDecisions.rowsAffected ?? 0),
  };
}

export interface ListAiBudgetReservationsFilter {
  periodKey?: string;
  runId?: string;
  nodeId?: string;
  status?: AiBudgetReservationStatus;
  from?: number;
  to?: number;
  limit?: number;
}

export async function listAiBudgetReservations(filter: ListAiBudgetReservationsFilter = {}) {
  await ensureDatabase();
  const limit = Math.min(Math.max(1, Math.floor(filter.limit ?? 500)), 5000);
  const conditions = [];
  if (filter.periodKey) conditions.push(eq(aiBudgetReservations.periodKey, filter.periodKey));
  if (filter.runId) conditions.push(eq(aiBudgetReservations.runId, filter.runId));
  if (filter.nodeId) conditions.push(eq(aiBudgetReservations.nodeId, filter.nodeId));
  if (filter.status) conditions.push(eq(aiBudgetReservations.status, filter.status));
  if (filter.from !== undefined) conditions.push(gte(aiBudgetReservations.createdAt, filter.from));
  if (filter.to !== undefined) conditions.push(lte(aiBudgetReservations.createdAt, filter.to));
  const rows = await db
    .select()
    .from(aiBudgetReservations)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(aiBudgetReservations.createdAt))
    .limit(limit);
  return rows.map(toAiBudgetReservation);
}

export interface RecordAiBudgetDecisionInput {
  gate: AiBudgetDecisionGate;
  /** The gate's own clock. */
  at: number;
  decision: AiBudgetDecision;
  purpose: string;
  runId?: string;
  nodeId?: string;
  taskId?: string;
  contentItemId?: string;
  /** The model the decision priced, `null` for the step gate (which routes nothing). */
  target?: { providerId: string; modelId: string; routeResolved: boolean } | null;
  /** The hold the verdict took, `null` when it took none. */
  reservation?: { id: string; amount: number; currency: string } | null;
  createdAt?: number;
}

/**
 * Stores one decision - **every** outcome, refusals included.
 *
 * A refusal used to exist only for as long as one 402 response. This is the record that outlives it,
 * and storing the *allowed* verdicts too is what makes a later refusal explainable: "there was room
 * at 10:00 and there was none at 10:04" is a comparison of two of these rows.
 *
 * Only what a decision is made of is stored: reason codes, amounts, counts, the period. No prompt,
 * no response, no credential - the estimate measured an input's length and forgot the text.
 */
export async function recordAiBudgetDecision(input: RecordAiBudgetDecisionInput) {
  await ensureDatabase();
  const { decision } = input;
  const estimate = decision.estimate;
  const id = nanoid();
  await db.insert(aiBudgetDecisions).values({
    id,
    at: input.at,
    gate: input.gate,
    status: decision.status,
    reasonsJson: JSON.stringify(decision.reasons),
    policy: decision.policy,
    unknownCostPolicy: decision.unknownCostPolicy,
    enforcement: decision.enforcement,
    periodKey: decision.period.key,
    currency: decision.currency,
    limitAmount: decision.limit,
    spentAmount: decision.spent.amount,
    spentIsComplete: decision.spent.isComplete,
    spentTruncated: decision.spent.truncated,
    reservedAmount: decision.reserved,
    remainingAmount: decision.remaining,
    projectedMin: decision.projectedMin,
    projectedMax: decision.projectedMax,
    certainty: decision.certainty,
    estimateKind: estimate.kind,
    estimateMethod: estimate.method,
    estimateNotesJson: JSON.stringify(estimate.notes),
    // An `unpriced`/`unknown` estimate carries no amount at all, so both stay NULL rather than 0.
    estimateAmountMin: estimate.kind === "estimate" ? estimate.amountMin : null,
    estimateAmountMax: estimate.kind === "estimate" ? estimate.amountMax : null,
    purpose: input.purpose,
    runId: input.runId ?? "",
    nodeId: input.nodeId ?? "",
    taskId: input.taskId ?? "",
    contentItemId: input.contentItemId ?? "",
    providerId: input.target?.providerId ?? "",
    modelId: input.target?.modelId ?? "",
    routeResolved: input.target?.routeResolved ?? false,
    reservationId: input.reservation?.id ?? "",
    reservationAmount: input.reservation ? input.reservation.amount : null,
    reservationCurrency: input.reservation?.currency ?? "",
    createdAt: input.createdAt ?? now(),
  });
  return getAiBudgetDecision(id);
}

function toAiBudgetDecisionRecord(row: typeof aiBudgetDecisions.$inferSelect): AiBudgetDecisionRecord {
  return {
    id: row.id,
    at: row.at,
    gate: row.gate as AiBudgetDecisionGate,
    status: row.status as AiBudgetDecisionStatus,
    reasons: parseJson<string[]>(row.reasonsJson, []),
    policy: row.policy,
    unknownCostPolicy: row.unknownCostPolicy,
    enforcement: row.enforcement,
    periodKey: row.periodKey,
    currency: row.currency,
    limitAmount: row.limitAmount ?? null,
    spentAmount: row.spentAmount,
    spentIsComplete: row.spentIsComplete,
    spentTruncated: row.spentTruncated,
    reservedAmount: row.reservedAmount,
    remainingAmount: row.remainingAmount ?? null,
    projectedMin: row.projectedMin ?? null,
    projectedMax: row.projectedMax ?? null,
    certainty: row.certainty,
    estimateKind: row.estimateKind,
    estimateMethod: row.estimateMethod,
    estimateNotes: parseJson<string[]>(row.estimateNotesJson, []),
    estimateAmountMin: row.estimateAmountMin ?? null,
    estimateAmountMax: row.estimateAmountMax ?? null,
    purpose: row.purpose,
    runId: row.runId,
    nodeId: row.nodeId,
    taskId: row.taskId,
    contentItemId: row.contentItemId,
    providerId: row.providerId,
    modelId: row.modelId,
    routeResolved: row.routeResolved,
    reservationId: row.reservationId,
    reservationAmount: row.reservationAmount ?? null,
    reservationCurrency: row.reservationCurrency,
    createdAt: row.createdAt,
  };
}

export async function getAiBudgetDecision(id: string) {
  await ensureDatabase();
  const [row] = await db.select().from(aiBudgetDecisions).where(eq(aiBudgetDecisions.id, id)).limit(1);
  return row ? toAiBudgetDecisionRecord(row) : null;
}

export interface ListAiBudgetDecisionsFilter {
  periodKey?: string;
  runId?: string;
  nodeId?: string;
  gate?: AiBudgetDecisionGate;
  status?: AiBudgetDecisionStatus;
  reservationId?: string;
  from?: number;
  to?: number;
  limit?: number;
}

export async function listAiBudgetDecisions(filter: ListAiBudgetDecisionsFilter = {}) {
  await ensureDatabase();
  const limit = Math.min(Math.max(1, Math.floor(filter.limit ?? 500)), 5000);
  const conditions = [];
  if (filter.periodKey) conditions.push(eq(aiBudgetDecisions.periodKey, filter.periodKey));
  if (filter.runId) conditions.push(eq(aiBudgetDecisions.runId, filter.runId));
  if (filter.nodeId) conditions.push(eq(aiBudgetDecisions.nodeId, filter.nodeId));
  if (filter.gate) conditions.push(eq(aiBudgetDecisions.gate, filter.gate));
  if (filter.status) conditions.push(eq(aiBudgetDecisions.status, filter.status));
  if (filter.reservationId) conditions.push(eq(aiBudgetDecisions.reservationId, filter.reservationId));
  if (filter.from !== undefined) conditions.push(gte(aiBudgetDecisions.at, filter.from));
  if (filter.to !== undefined) conditions.push(lte(aiBudgetDecisions.at, filter.to));
  const rows = await db
    .select()
    .from(aiBudgetDecisions)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(aiBudgetDecisions.at))
    .limit(limit);
  return rows.map(toAiBudgetDecisionRecord);
}

export interface ReconcileAiBudgetFilter {
  periodKey?: string;
  runId?: string;
  nodeId?: string;
  from?: number;
  to?: number;
  limit?: number;
  /** The instant the audit is made at; it decides which holds have expired. Defaults to now. */
  at?: number;
}

/**
 * Puts the holds and the ledger side by side (CI-P7-03-A) - the "可对账" half of the card.
 *
 * The join is on `ai_usage_ledger.budget_reservation_id`, an id the gate wrote onto the row it
 * admitted, so this is a comparison rather than a correlation: no matching by purpose, by run or by
 * "close enough in time", each of which would invent a link that may not exist.
 *
 * The verdicts a reader needs to distrust are the reason this is a function and not a subtraction:
 *
 * - `no-ledger` - released with nothing linked. Either nothing was sent, or the ledger write failed;
 *   this cannot tell them apart, and pretending it could would hide a bookkeeping failure.
 * - `over-reserved` - the linked rows state **more** than the hold. The estimate was short, which is
 *   the one outcome a ceiling is supposed to make impossible to miss.
 * - `expired-with-ledger` - the call happened and its process died before settling: the money is
 *   real and the hold is not.
 *
 * It reaps first (one `UPDATE`), so `status` and `expired` cannot disagree in the answer.
 */
export async function reconcileAiBudgetReservations(filter: ReconcileAiBudgetFilter = {}): Promise<AiBudgetReconciliation> {
  const at = filter.at ?? now();
  await sweepAiBudgetReservations(at);

  const limit = Math.min(Math.max(1, Math.floor(filter.limit ?? 500)), 500);
  const selected = await listAiBudgetReservations({
    periodKey: filter.periodKey,
    runId: filter.runId,
    nodeId: filter.nodeId,
    from: filter.from,
    to: filter.to,
    limit: limit + 1,
  });
  const truncated = selected.length > limit;
  const reservations = truncated ? selected.slice(0, limit) : selected;

  const ledgerRows = reservations.length
    ? await db
        .select({
          reservationId: aiUsageLedger.budgetReservationId,
          costAmount: aiUsageLedger.costAmount,
          costCurrency: aiUsageLedger.costCurrency,
          costSource: aiUsageLedger.costSource,
        })
        .from(aiUsageLedger)
        .where(
          inArray(
            aiUsageLedger.budgetReservationId,
            reservations.map((reservation) => reservation.id),
          ),
        )
    : [];

  const currencyOf = new Map(reservations.map((reservation) => [reservation.id, reservation.currency]));
  const linked = new Map<string, AiBudgetReconciliationLedger>();
  for (const row of ledgerRows) {
    const reservationId = row.reservationId;
    if (!reservationId) continue;
    const entry =
      linked.get(reservationId) ??
      ({
        rows: 0,
        statedAmount: null,
        unpricedRows: 0,
        unmeasuredRows: 0,
        otherCurrencyRows: 0,
        otherCurrencies: [],
      } as AiBudgetReconciliationLedger);
    entry.rows += 1;
    if (row.costAmount === null) {
      // Two different blanks, kept apart: `unpriced` is "the catalog has no price", `unknown` is
      // "nothing arrived to charge for". Neither is a 0.
      if (row.costSource === "unpriced") entry.unpricedRows += 1;
      else entry.unmeasuredRows += 1;
    } else if (row.costCurrency === currencyOf.get(reservationId)) {
      entry.statedAmount = roundAmount((entry.statedAmount ?? 0) + row.costAmount);
    } else {
      entry.otherCurrencyRows += 1;
      if (row.costCurrency && !entry.otherCurrencies.includes(row.costCurrency)) {
        entry.otherCurrencies.push(row.costCurrency);
      }
    }
    linked.set(reservationId, entry);
  }

  // Every verdict appears, zeroes included, and the record is a literal so adding a verdict to the
  // vocabulary breaks this build until it is counted here.
  const verdicts: Record<AiBudgetReconciliationVerdict, number> = {
    held: 0,
    "expired-unspent": 0,
    "expired-with-ledger": 0,
    "no-ledger": 0,
    "ledger-unknown": 0,
    "currency-mismatch": 0,
    "under-reserved": 0,
    "over-reserved": 0,
    matched: 0,
  };
  const ledgerStatedByCurrency: Record<string, number> = {};
  let heldAmount = 0;
  let settledAmount = 0;
  let expiredAmount = 0;

  const rows: AiBudgetReconciliationRow[] = reservations.map((reservation) => {
    // Expired either because the row says so (a sweep marked it) or because its TTL passed and nothing
    // has marked it yet. Both are the same fact to a reader, and the second is exactly why the stored
    // status may lag while this flag cannot.
    const expired =
      reservation.status === "expired" ||
      (reservation.status === "held" && reservation.expiresAt <= at);
    const ledger =
      linked.get(reservation.id) ??
      ({
        rows: 0,
        statedAmount: null,
        unpricedRows: 0,
        unmeasuredRows: 0,
        otherCurrencyRows: 0,
        otherCurrencies: [],
      } as AiBudgetReconciliationLedger);
    const verdict = budgetReconciliationVerdict({ reservation, expired, ledger });
    verdicts[verdict] += 1;
    if (reservation.status === "settled") {
      settledAmount = roundAmount(settledAmount + reservation.amount);
    } else if (expired || reservation.status === "expired") {
      expiredAmount = roundAmount(expiredAmount + reservation.amount);
    } else {
      heldAmount = roundAmount(heldAmount + reservation.amount);
    }
    if (ledger.statedAmount !== null) {
      ledgerStatedByCurrency[reservation.currency] = roundAmount(
        (ledgerStatedByCurrency[reservation.currency] ?? 0) + ledger.statedAmount,
      );
    }
    return {
      reservationId: reservation.id,
      purpose: reservation.purpose,
      runId: reservation.runId,
      nodeId: reservation.nodeId,
      taskId: reservation.taskId,
      contentItemId: reservation.contentItemId,
      meteredKind: reservation.meteredKind,
      providerId: reservation.providerId,
      modelId: reservation.modelId,
      periodKey: reservation.periodKey,
      currency: reservation.currency,
      status: reservation.status,
      expired,
      reservedAmount: reservation.amount,
      createdAt: reservation.createdAt,
      expiresAt: reservation.expiresAt,
      settledAt: reservation.settledAt,
      settleKind: reservation.settleKind,
      ledger,
      verdict,
    };
  });

  return {
    from: filter.from ?? null,
    to: filter.to ?? null,
    rows,
    totals: {
      reservations: rows.length,
      heldAmount,
      settledAmount,
      expiredAmount,
      ledgerStatedByCurrency,
      verdicts,
    },
    truncated,
  };
}

/**
 * One hold's verdict. The order of the questions is the order of how much each answer hides:
 * liveness first, then "is there anything to compare at all", then why a figure is missing.
 */
function budgetReconciliationVerdict(input: {
  reservation: AiBudgetReservation;
  expired: boolean;
  ledger: AiBudgetReconciliationLedger;
}): AiBudgetReconciliationVerdict {
  const { reservation, expired, ledger } = input;
  if (reservation.status === "held" && !expired) return "held";
  if (ledger.rows === 0) return expired ? "expired-unspent" : "no-ledger";
  if (expired) return "expired-with-ledger";
  if (ledger.unpricedRows > 0 || ledger.unmeasuredRows > 0) return "ledger-unknown";
  if (ledger.otherCurrencyRows > 0) return "currency-mismatch";
  const stated = roundAmount(ledger.statedAmount ?? 0);
  const reserved = roundAmount(reservation.amount);
  if (stated < reserved) return "under-reserved";
  if (stated > reserved) return "over-reserved";
  return "matched";
}
