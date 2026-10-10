import { z } from "zod";
import {
  createAgentChatThread,
  createAgentChatMessage,
  createAgentToolCall,
  createSchedule,
  getContentItem,
  getAgentChatThread,
  getAccount,
  listAccounts,
  listAgentChatMessages,
} from "@/db/repository";
import { defaultChatThreadTitle, updateChatThreadTitleIfNeeded } from "@/lib/agent/chat-thread-title";
import { buildAgentChatContext } from "@/lib/agent/chat-context";
import { getLocalAgentSettings } from "@/db/repositories/settings";
import { LangGraphAgentEngine } from "@/lib/agent/langgraph-engine";
import { looksLikeScheduleRequest, resolveScheduleIntent } from "@/lib/agent/schedule-intent";
import { fail, ok, parseJson } from "@/lib/api";
import { localeResources, normalizeLocale } from "@/lib/locale-resources";
import type { AccountRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  message: z.string().trim().min(1),
  threadId: z.string().trim().optional(),
  targetAccountId: z.string().trim().optional(),
  params: z.record(z.string(), z.unknown()).optional().default({}),
  locale: z.string().trim().optional(),
});

async function persistLocalToolCalls(input: {
  threadId: string;
  assistantMessageId: string;
  site?: AccountRecord;
  toolCalls: Array<{
    name: string;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    status: "completed" | "failed" | "pending";
  }>;
}) {
  const stored = [];
  for (const tool of input.toolCalls) {
    stored.push(
      await createAgentToolCall({
        threadId: input.threadId,
        messageId: input.assistantMessageId,
        name: tool.name,
        status: tool.status === "pending" ? "pending" : tool.status,
        accountId: input.site?.id,
        input: tool.input,
        output: {
          ...tool.output,
          loginRequired: tool.name.startsWith("browser_") && input.site?.status === "needs_login",
        },
        creditType: tool.name.includes("image") ? "image" : undefined,
        creditCost: tool.name.includes("image") ? 0 : undefined,
      }),
    );
  }
  return stored;
}

export async function GET(request: Request) {
  try {
    const threadId = new URL(request.url).searchParams.get("threadId") || undefined;
    if (!threadId) return ok({ thread: null, messages: [] });
    const thread = await getAgentChatThread(threadId);
    if (!thread) return fail("Chat thread not found", 404);
    return ok({ thread, messages: await listAgentChatMessages(thread.id) });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to load chat history", 500);
  }
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return fail("Invalid agent chat payload", 400, parsed.error);

  try {
    const site = parsed.data.targetAccountId ? await getAccount(parsed.data.targetAccountId) : undefined;
    if (parsed.data.targetAccountId && !site) return fail("Target site not found", 404);

    const settings = await getLocalAgentSettings();
    const locale = normalizeLocale(parsed.data.locale);
    const thread = parsed.data.threadId
      ? await getAgentChatThread(parsed.data.threadId, site?.id)
      : await createAgentChatThread({ activeAccountId: site?.id, title: defaultChatThreadTitle(locale) });
    if (!thread) return fail("Chat thread not found", 404);
    const userMessage = await createAgentChatMessage({
      threadId: thread.id,
      role: "user",
      content: parsed.data.message,
      accountId: site?.id,
      metadata: site ? { accountName: site.name, siteStatus: site.status } : {},
    });
    const messagesAfterUser = await listAgentChatMessages(thread.id);
    const chatContext = buildAgentChatContext(messagesAfterUser);

    if (looksLikeScheduleRequest(parsed.data.message)) {
      const scheduleText = localeResources[locale];
      let assistantText = scheduleText.schedulePostPrepared;
      try {
        if (!chatContext.latestContentItemId) throw new Error(scheduleText.schedulePostMissingContent);
        const content = await getContentItem(chatContext.latestContentItemId);
        if (!content) throw new Error(scheduleText.schedulePostMissingContent);
        const intent = resolveScheduleIntent({
          message: parsed.data.message,
          accounts: await listAccounts(),
          selectedSite: site ?? undefined,
        });
        const toolInput = {
          scheduledAt: intent.scheduledAt,
          timeZone: intent.timeZone,
          accountId: intent.site.id,
          accountName: intent.site.name,
          contentItemId: content.id,
          postPreview: content.postReadyText || content.body,
        };
        const autoApprove = settings.agentPermissions.schedulePost === "auto";
        const schedule = autoApprove ? await createSchedule({
          playbookId: "threads_auto_post",
          accountId: intent.site.id,
          enabled: true,
          scheduleTimes: [{ type: "once", at: new Date(intent.scheduledAt).toISOString() }],
          params: { contentItemId: content.id, scheduledPublishAuthorized: true },
          nextRunAt: intent.scheduledAt,
          contentItemId: content.id,
          publishAuthorized: true,
        }) : null;
        if (autoApprove && !schedule) throw new Error(scheduleText.schedulePostCreateFailed);
        assistantText = autoApprove ? scheduleText.schedulePostCreated : scheduleText.schedulePostApprovalRequired;
        const assistant = await createAgentChatMessage({
          threadId: thread.id,
          role: "assistant",
          content: assistantText,
          accountId: intent.site.id,
          mode: "local",
          metadata: { userMessageId: userMessage.id, scheduleRequest: true },
        });
        await createAgentToolCall({
          threadId: thread.id,
          messageId: assistant.id,
          name: "schedule_threads_post",
          status: autoApprove ? "completed" : "pending",
          accountId: intent.site.id,
          input: toolInput,
          output: schedule ? { scheduleId: schedule.id, status: schedule.status } : {},
        });
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : String(error);
        assistantText = /time such as/i.test(rawMessage) ? scheduleText.schedulePostInvalidTime
          : /supports one-time|future/i.test(rawMessage) ? scheduleText.schedulePostInvalidDate
          : /More than one/i.test(rawMessage) ? scheduleText.schedulePostAmbiguousAccount
          : /could not identify/i.test(rawMessage) ? scheduleText.schedulePostMissingAccount
          : /no browser profile/i.test(rawMessage) ? scheduleText.schedulePostMissingProfile
          : rawMessage;
        await createAgentChatMessage({
          threadId: thread.id,
          role: "assistant",
          content: assistantText,
          accountId: site?.id,
          mode: "local",
          metadata: { userMessageId: userMessage.id, scheduleRequest: true, failed: true },
        });
      }
      return ok({
        mode: "local",
        assistant: assistantText,
        thread,
        messages: await listAgentChatMessages(thread.id),
      });
    }

    const engine = new LangGraphAgentEngine();
    const local = await engine.run({
      threadId: thread.id,
      site: site ?? undefined,
      message: parsed.data.message,
      params: parsed.data.params,
      locale,
      chatContext,
    });
    const assistant = await createAgentChatMessage({
      threadId: thread.id,
      role: "assistant",
      content: local.assistant,
      accountId: site?.id,
      mode: "local",
      metadata: {
        userMessageId: userMessage.id,
        targetSiteName: site?.name,
        localAgentRunId: local.run.id,
        localAgentStatus: local.status,
      },
    });
    await persistLocalToolCalls({
      threadId: thread.id,
      assistantMessageId: assistant.id,
      site: site ?? undefined,
      toolCalls: local.toolCalls,
    });
    const responseThread = await updateChatThreadTitleIfNeeded({
      thread,
      messages: messagesAfterUser,
      locale,
      jobDone: local.status !== "queued" && local.status !== "running" && local.status !== "paused",
      // CI-P7-01-04: the title's own model call is attributed to the run that produced it.
      runId: local.run.id,
    });
    return ok({
      mode: "local",
      assistant: local.assistant,
      thread: responseThread,
      agentRunId: local.run.id,
      status: local.status,
      messages: await listAgentChatMessages(thread.id),
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Agent chat failed", 500);
  }
}
