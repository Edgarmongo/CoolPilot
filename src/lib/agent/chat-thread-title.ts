import { updateAgentChatThreadTitle } from "@/db/repository";
import { aiRuntime } from "@/features/ai-runtime";
import { chatTitleSchema } from "@/lib/ai/schemas";
import { beginAiBudgetCall, type AiBudgetCallHandle } from "@/lib/ai-budget-guard";
import { recordAiUsageCall, recordAiUsageFailure, type AiUsageCallContext } from "@/lib/ai-usage-ledger-recorder";
import type { Locale } from "@/lib/i18n-config";
import type { AgentChatMessageWithTools, AgentChatThreadRecord } from "@/lib/types";

const genericTitles = new Set(["", "chat", "new chat", "\u804a\u5929", "\u65b0\u804a\u5929"]);
const maxTitleLength = 64;

export function defaultChatThreadTitle(locale: Locale) {
  return locale === "en" ? "Chat" : "\u804a\u5929";
}

export function normalizeChatThreadTitle(title: string) {
  const cleaned = title.replace(/\s+/g, " ").trim().replace(/[.。!！?？]+$/g, "");
  if (!cleaned) return "";
  return cleaned.length > maxTitleLength ? cleaned.slice(0, maxTitleLength).trim() : cleaned;
}

export function isGenericChatThreadTitle(title: string) {
  return genericTitles.has(normalizeChatThreadTitle(title).toLowerCase());
}

export function userMessagesForTitle(messages: AgentChatMessageWithTools[]) {
  return messages
    .filter((message) => message.role === "user")
    .map((message) => message.content.trim())
    .filter(Boolean)
    .slice(-6);
}

export function shouldGenerateChatThreadTitle(input: {
  thread: AgentChatThreadRecord;
  messages: AgentChatMessageWithTools[];
  jobDone: boolean;
}) {
  if (!isGenericChatThreadTitle(input.thread.title)) return false;
  const userMessageCount = input.messages.filter((message) => message.role === "user").length;
  return input.jobDone || userMessageCount >= 3;
}

function fallbackTitle(messages: string[], locale: Locale) {
  const prefix = defaultChatThreadTitle(locale);
  const firstMessage = normalizeChatThreadTitle(messages[0] ?? "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/@\S+/g, "")
    .trim();
  if (!firstMessage) return prefix;
  const snippet = firstMessage.length > 46 ? firstMessage.slice(0, 46).trim() : firstMessage;
  return `${prefix}: ${snippet}`;
}

export async function generateChatThreadTitle(input: {
  messages: string[];
  locale: Locale;
  preferredTitle?: string;
  /** The agent run this title belongs to, when the caller has one. */
  runId?: string;
}) {
  const preferredTitle = normalizeChatThreadTitle(input.preferredTitle ?? "");
  if (preferredTitle && !isGenericChatThreadTitle(preferredTitle)) {
    return preferredTitle;
  }

  const messages = input.messages.map((message) => message.trim()).filter(Boolean);
  if (messages.length === 0) return "";

  // CI-P7-01-04. A title is generated after the answer the user is waiting for, which makes this the
  // easiest call in the app to spend money on invisibly. The ledger row is what makes it visible.
  const usageCall: AiUsageCallContext = { purpose: "chat-title", runId: input.runId };
  const language = input.locale === "zh-hk" ? "Traditional Chinese for Hong Kong" : input.locale === "en" ? "English" : "Simplified Chinese";
  // Built once and used twice: the gate measures the same text the request carries.
  const promptText = [
    "Create one concise title for this chat history.",
    `Language: ${language}.`,
    "Rules: the title field must be 2 to 8 words, no generic title like Chat.",
    "User messages:",
    ...messages.map((message, index) => `${index + 1}. ${message}`),
  ].join("\n");

  // CI-P7-03. A refused title is not worth blocking the chat over: it degrades to the same local
  // fallback a provider failure uses, and the refusal itself is the user's own budget policy speaking.
  // A settings or ledger read that failed instead lands here too, which is the behaviour this function
  // had before the gate existed - a title never blocks the answer it belongs to.
  let budget: AiBudgetCallHandle;
  try {
    budget = await beginAiBudgetCall({
      identity: usageCall,
      purpose: usageCall.purpose,
      capabilities: ["chat"],
      inputText: promptText,
    });
    // CI-P7-03-A: the hold's id travels onto this call's ledger rows, so what was held and what
    // was spent are compared by an id instead of correlated by purpose and time.
    usageCall.budgetReservationId = budget.reservationId ?? undefined;
  } catch {
    return fallbackTitle(messages, input.locale);
  }

  try {
    const response = await aiRuntime.chatStructured({
      messages: [{ role: "user", content: promptText }],
      schema: chatTitleSchema,
    });
    await recordAiUsageCall({ ...usageCall, attempts: response.attempts });
    const generated = normalizeChatThreadTitle(response.data.title);
    if (generated && !isGenericChatThreadTitle(generated)) {
      return generated;
    }
  } catch (error) {
    // Title generation should never block the chat response - and the ledger row is written first,
    // so a failed request (which may still have been billed) is recorded rather than swallowed.
    await recordAiUsageFailure(usageCall, error);
  } finally {
    await budget.release();
  }

  return fallbackTitle(messages, input.locale);
}

export async function updateChatThreadTitleIfNeeded(input: {
  thread: AgentChatThreadRecord;
  messages: AgentChatMessageWithTools[];
  locale: Locale;
  jobDone: boolean;
  preferredTitle?: string;
  /** The agent run that produced these messages, so the title's cost is attributed to it. */
  runId?: string;
}) {
  if (!shouldGenerateChatThreadTitle(input)) return input.thread;
  const title = await generateChatThreadTitle({
    messages: userMessagesForTitle(input.messages),
    locale: input.locale,
    preferredTitle: input.preferredTitle,
    runId: input.runId,
  });
  if (!title || isGenericChatThreadTitle(title)) return input.thread;
  return (await updateAgentChatThreadTitle(input.thread.id, title)) ?? input.thread;
}
