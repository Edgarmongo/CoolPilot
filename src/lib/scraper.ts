import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import { aiRuntime, type StructuredChatResponse } from "@/features/ai-runtime";
import { AppError } from "@/lib/app-errors";
import { beginAiBudgetCall } from "@/lib/ai-budget-guard";
import { postDraftSchema } from "@/lib/ai/schemas";
import { recordAiUsageCall, recordAiUsageFailure, type AiUsageCallContext } from "@/lib/ai-usage-ledger-recorder";
import { normalizePostText } from "./post-format";

/**
 * Article reading and the two social-draft generators.
 *
 * Both generators run on `aiRuntime` directly (P3-A1 of `docs/generate-migration-p3.md`): provider
 * order, model choice, key rotation, failover and usage are the runtime's business, and all this file
 * still owns is the prompt, the draft normalisation and the error meaning its callers see. The legacy
 * `generateStructured` facade is no longer imported here, so nothing in this path depends on it.
 */

export async function fetchArticleText(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const html = await response.text();
  const $ = cheerio.load(html);
  $("script,style,nav,header,footer,aside,form,iframe").remove();
  const title =
    $("meta[property='og:title']").attr("content")?.trim() ||
    $("title").first().text().trim() ||
    $("h1").first().text().trim();
  const imageUrl = $("meta[property='og:image']").attr("content")?.trim() || "";
  const text = normalizePostText($("article").text().trim() || $("main").text().trim() || $("body").text().trim());
  return { title, text: text.slice(0, 12_000), imageUrl };
}

function toPostDraft(draft: { title: string; body: string }, fallbackTitle: string) {
  const title = normalizePostText(draft.title) || fallbackTitle;
  const body = normalizePostText(draft.body);
  return {
    title,
    body,
    postReadyText: normalizePostText(title && body && body !== title ? `${title}\n\n${body}` : body || title),
  };
}

/**
 * `MODEL_CREDENTIAL_*` is the runtime's way of saying "a key belongs to this call and is not
 * usable" (missing, unusable, rejected). The whole family means the same thing to a consumer -
 * fix the credential, do not retry the request - so it passes through unwrapped (D-P3-3) instead of
 * being flattened into a message-only `Error` that nothing can branch on.
 */
function isCredentialFailure(error: unknown): error is AppError {
  return error instanceof AppError && error.code.startsWith("MODEL_CREDENTIAL_");
}

export async function rewriteArticle(input: {
  title: string;
  text: string;
  maxWords?: number;
  language?: string;
  prompt?: string;
  /** The automation run (`AutomationContext.runId`) that asked for this rewrite. */
  runId?: string;
}) {
  const language = input.language ?? "Simplified Chinese";
  const maxWords = input.maxWords ?? 300;
  const prompt = [
    `Rewrite the article into a ready-to-post social media draft in ${language}.`,
    `Keep the body to roughly ${maxWords} words.`,
    "title: a short, catchy headline. body: the post copy a reader can publish as-is.",
    input.prompt ? `Additional requirements: ${input.prompt}` : "",
    "",
    `Article title: ${input.title}`,
    `Article text: ${input.text.slice(0, 7000)}`,
  ]
    .filter(Boolean)
    .join("\n");

  const usageCall: AiUsageCallContext = { purpose: "rewrite", runId: input.runId };

  // CI-P7-03. The budget gate stands between the prompt and the request. A refusal is thrown from here,
  // *outside* the try below, so it is neither written to the ledger (no request was sent, so there is
  // nothing to account for) nor flattened into the legacy `AI rewrite failed: …` wording, which means
  // "the provider failed" and would be a false statement about a call that never left this process.
  const budget = await beginAiBudgetCall({
    identity: usageCall,
    purpose: usageCall.purpose,
    capabilities: ["chat"],
    inputText: prompt,
  });
  // CI-P7-03-A: the hold's id travels onto this call's ledger rows, so what was held and what
  // was spent are compared by an id instead of correlated by purpose and time.
  usageCall.budgetReservationId = budget.reservationId ?? undefined;
  try {
    const response = await aiRuntime.chatStructured({
      messages: [{ role: "user", content: prompt }],
      schema: postDraftSchema,
    });
    // CI-P7-01-04: one ledger row per request the runtime sent, attributed to the run that asked.
    await recordAiUsageCall({ ...usageCall, attempts: response.attempts });
    return {
      ...toPostDraft(response.data, input.title),
      provider: response.providerId,
      model: response.model,
      usage: response.usage,
    };
  } catch (error) {
    // The credential cases are the caller's to report; everything else keeps the legacy message.
    // Recorded first, because a rejected request may still have been billed.
    await recordAiUsageFailure(usageCall, error);
    if (isCredentialFailure(error)) {
      throw error;
    }
    throw new Error(`AI rewrite failed: ${(error as Error).message}`);
  } finally {
    await budget.release();
  }
}

export async function generateTopicPost(input: {
  topic: string;
  keywords?: string;
  maxWords?: number;
  language?: string;
  prompt?: string;
  systemPrompt?: string;
  /** The automation run (`AutomationContext.runId`) that asked for this draft. */
  runId?: string;
}) {
  const prompt = [
    `Write a ready-to-post Threads social media draft in ${input.language ?? "Simplified Chinese"}.`,
    `Topic: ${input.topic}`,
    `Keep the body to roughly ${input.maxWords ?? 300} words.`,
    "title: a short, catchy headline. body: the post copy a reader can publish as-is.",
    input.keywords ? `Include these keywords naturally: ${input.keywords}` : "",
    input.prompt ? `Additional requirements: ${input.prompt}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const usageCall: AiUsageCallContext = { purpose: "topic-post", runId: input.runId };

  // CI-P7-03, the same gate as `rewriteArticle` above, for the same reason: this is where the worker's
  // topic/article playbooks really spend, so the gate belongs at the call rather than at the playbook.
  const budget = await beginAiBudgetCall({
    identity: usageCall,
    purpose: usageCall.purpose,
    capabilities: ["chat"],
    inputText: prompt,
  });
  // CI-P7-03-A: the hold's id travels onto this call's ledger rows, so what was held and what
  // was spent are compared by an id instead of correlated by purpose and time.
  usageCall.budgetReservationId = budget.reservationId ?? undefined;
  let response: StructuredChatResponse<typeof postDraftSchema>;
  try {
    response = await aiRuntime.chatStructured({
      messages: [{ role: "user", content: prompt }],
      systemPrompt: input.systemPrompt,
      schema: postDraftSchema,
    });
  } catch (error) {
    // This function has no error contract of its own: it rethrows, so the row has to be written
    // here, before the failure leaves the module.
    await recordAiUsageFailure(usageCall, error);
    throw error;
  } finally {
    await budget.release();
  }
  await recordAiUsageCall({ ...usageCall, attempts: response.attempts });
  return {
    ...toPostDraft(response.data, input.topic),
    provider: response.providerId,
    model: response.model,
    usage: response.usage,
  };
}

export async function searchGoogleNews(topic: string, maxItems = 5) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=zh-HK&gl=HK&ceid=HK:zh-Hant`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 Chrome/120 Safari/537.36" },
  });
  if (!response.ok) {
    throw new Error(`Google News RSS HTTP ${response.status}`);
  }
  const xml = await response.text();
  const parser = new XMLParser();
  const data = parser.parse(xml);
  const items = data?.rss?.channel?.item;
  const normalized = Array.isArray(items) ? items : items ? [items] : [];
  return normalized.slice(0, maxItems).map((item) => ({
    title: String(item.title ?? ""),
    link: String(item.link ?? ""),
    pubDate: String(item.pubDate ?? ""),
    description: String(item.description ?? ""),
  }));
}
