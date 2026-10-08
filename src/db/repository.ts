import { and, asc, desc, eq, gte, isNotNull, like, lte, sql } from "drizzle-orm";
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
} from "@/lib/types";
import { db, ensureDatabase } from "./client";
import {
  agentRuntimeEvents,
  agentRuntimeRuns,
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
import { summarizeUsageRecords, usageRangeStart } from "@/lib/usage";

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
  // The generated image becomes the cover, so it must lead the image list too.
  const images = [input.imagePath, ...contentImageList(current).filter((entry) => entry !== input.imagePath)].slice(0, 12);
  const metadata = {
    ...current.metadata,
    images,
    ...(input.imagePrompt ? { imagePrompt: input.imagePrompt } : {}),
    ...(input.provider ? { imageProvider: input.provider } : {}),
    ...(input.model ? { imageModel: input.model } : {}),
  };
  await db.update(contentItems).set({
    imagePath: input.imagePath,
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
