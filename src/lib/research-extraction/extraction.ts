import { z } from "zod";
import { formatTranscriptTimestamp, type TranscriptionSegmentRecord } from "@/lib/transcription/transcription";

/**
 * The research-extraction contract (CI-P3-03 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * This file is the pure half, the same split `@/lib/transcription/transcription` and `@/lib/research`
 * use: it opens no file, calls no model and writes no row, so it is importable from a browser component
 * and testable without a database. The executor that really calls the model is `./extraction-task.ts`,
 * and the material row is written by `@/db/repositories/research`.
 *
 * Five rules it exists to keep:
 *
 * 1. **A摘要 is not a fact, and a fact is not a suggestion.** The three outputs are separate fields with
 *    separate provenance: `summary`/`keyPoints` condense the source, `facts` and `quotes` carry the
 *    original excerpt they came from, and `topicSuggestions` are the model's *ideas*, marked as such
 *    everywhere they are shown or sent onwards. Nothing merges the three back together.
 * 2. **Verified means the source really says it.** `evidence` is never trusted because the model wrote
 *    it: it is matched against the material's own stored text by `researchExtractionEvidenceVerified()`,
 *    a pure string check on the same text a generation reads. A fact with no locatable excerpt is shown
 *    as 未核实 and is not injected into a writing prompt as a fact.
 * 3. **A refusal has a stable name**, so the console can say "there is no text to distil" or "no model
 *    can serve this" instead of "failed", and a test can assert the exact reason.
 * 4. **Empty is not success.** `EXTRACTION_EMPTY` is its own outcome: a model that answers with nothing
 *    usable must not leave a stored extraction behind.
 * 5. **A new version does not silently become the old one.** Every stored result carries its `revision`
 *    and the run that produced it, and the version it replaced is kept, so "这是第 2 版，上一版来自任务
 *    X" is a fact of the record rather than a guess.
 */

/** The task type an extraction run carries (`runs.playbook_id`); one literal, shared by every writer. */
export const researchExtractionPlaybookId = "research_extraction";

/**
 * Every way an extraction run can refuse, as a stable name.
 *
 * The list is closed on purpose, exactly like `transcriptionFailureCodes`: the task maps each code to
 * something the caller can act on, and a code that is not here cannot be produced.
 */
export const researchExtractionFailureCodes = [
  /** The stored request is not a valid extraction request (a hand-written `runs` row, say). */
  "REQUEST_INVALID",
  /** The material the request names is not in the workspace any more. */
  "MATERIAL_MISSING",
  /** The material exists but carries no text to distil (never read, or read as an empty page). */
  "MATERIAL_EMPTY",
  /** No credential/model can serve a chat call, or every key is cooled down. */
  "PROVIDER_UNAVAILABLE",
  /**
   * CI-P7-03: the AI budget policy refused the call before it was sent.
   *
   * Its own code because it is not a provider failure: no key was tried, nothing was billed, and the only
   * thing that can clear it is the budget (a higher limit, a different policy) - retrying unchanged would
   * be refused again.
   */
  "BUDGET_EXCEEDED",
  /** The model answered twice with something the result schema refuses. Never stored. */
  "EXTRACTION_INVALID",
  /** The model answered, and what it said carried no usable result. Never stored. */
  "EXTRACTION_EMPTY",
  /** The run exceeded its own budget and was abandoned. */
  "EXTRACTION_TIMEOUT",
  /** The model failed for a reason of its own; `message` carries what it said. */
  "EXTRACTION_FAILED",
] as const;

export type ResearchExtractionFailureCode = (typeof researchExtractionFailureCodes)[number];

/** A refusal with a stable code. Thrown by the task, never swallowed. */
export class ResearchExtractionFailure extends Error {
  constructor(
    public readonly code: ResearchExtractionFailureCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "ResearchExtractionFailure";
  }
}

export function isResearchExtractionFailure(error: unknown): error is ResearchExtractionFailure {
  return error instanceof ResearchExtractionFailure;
}

/**
 * How much of a stored material may enter one extraction prompt.
 *
 * A page reader caps a page at 12 000 characters and a writing prompt injects a smaller window still
 * (`researchMaterialPromptLimit`). Distillation is the case that wants the most text and produces the
 * smallest answer, so it gets the reader's own cap - and the cap is a documented limitation of the run,
 * never a claim about the record: the workspace shows the whole stored text, and every excerpt a result
 * quotes is verified against that whole text.
 */
export const researchExtractionSourceLimit = 12_000;

/** How many replaced versions one material keeps, newest first. */
export const researchExtractionHistoryLimit = 5;

/**
 * How much of a stored result may enter a *writing* prompt (P3-03-06).
 *
 * An article prompt is a summary-shaped consumer, not the place to re-read a study: it receives the
 * digest (summary, key points, verified facts and quotes) under explicit caps. `topicSuggestions` are
 * deliberately not part of this block - they are the model's ideas about what to write next, and a
 * writing prompt that received them as material would be treating a suggestion as a source fact.
 */
export const researchExtractionPromptLimits = {
  summary: 800,
  keyPoints: 6,
  facts: 8,
  quotes: 5,
} as const;

/** The request one `research_extraction` task stores in `runs.params_json`. */
export const researchExtractionRequestSchema = z.object({
  materialId: z.string().trim().min(1).max(60),
  /** A caller's own dedupe key: the same key never starts a second run. */
  idempotencyKey: z.string().trim().max(120).optional().default(""),
});

export type ResearchExtractionRequest = z.infer<typeof researchExtractionRequestSchema>;

/**
 * What the model is asked to answer.
 *
 * These descriptions are the schema the runtime embeds in the prompt (`chatStructured`), so they read as
 * instructions: what a 摘要 is (a faithful condensation, no new claims), what `evidence` must be (an
 * excerpt copied from the source, character for character), and what `topicSuggestions` are (ideas for
 * the user, not findings). No field has a default: a model that omits one is told so by validation
 * instead of being handed an empty string.
 */
export const researchExtractionOutputSchema = z.object({
  summary: z
    .string()
    .min(1)
    .describe("A faithful summary of the source in 2 to 5 sentences. No claim the source does not make."),
  keyPoints: z
    .array(z.string())
    .max(12)
    .describe("The main points of the source, one short sentence each, in the source's own order."),
  facts: z
    .array(
      z.object({
        statement: z.string().describe("One factual statement or figure taken from the source."),
        evidence: z
          .string()
          .describe(
            "The exact excerpt of the source this statement is based on, copied character for character. Empty when there is no such excerpt.",
          ),
      }),
    )
    .max(20)
    .describe("Facts and figures the source states, each with the excerpt it came from."),
  quotes: z
    .array(z.string())
    .max(12)
    .describe("Notable verbatim sentences from the source, copied character for character."),
  topicSuggestions: z
    .array(
      z.object({
        title: z.string().describe("A content idea the user could develop, not a finding of the source."),
        rationale: z.string().describe("Why this idea is worth developing from this source."),
      }),
    )
    .max(8)
    .describe("Content ideas for the user. These are suggestions, never facts of the source."),
});

export type ResearchExtractionOutput = z.infer<typeof researchExtractionOutputSchema>;

/**
 * What was distilled, and where it came from.
 *
 * It is the run's own record kept on the material it belongs to - the shape `transcriptMetadataSchema`
 * chose for a transcript - so a stored result stays self-describing after the task's log is gone: which
 * material and which version of it, which model, when, and whether a human has edited it since.
 */
export const researchExtractionRecordSchema = researchExtractionOutputSchema.extend({
  /** 1 for the first result on a material, one more for every regeneration. */
  revision: z.number().int().positive(),
  /** The run that produced this version. */
  taskId: z.string(),
  providerId: z.string(),
  model: z.string(),
  generatedAt: z.number().int(),
  /** When a human last edited this version; `null` while nobody has. */
  editedAt: z.number().int().nullable(),
  /** The material this came from, as the run read it. */
  materialId: z.string(),
  materialTitle: z.string(),
  /** `text` / `url` / `file` / `audio` / `video` - how the material's text got here. */
  materialKind: z.string(),
  sourceUrl: z.string(),
  /** How many characters of the material's text the run actually read. */
  sourceCharacters: z.number().int().nonnegative(),
  /**
   * A fingerprint of the text this version was distilled from.
   *
   * It is what makes "素材在提炼之后又改过" a fact rather than a warning nobody can check: the same
   * fingerprint is computed from the stored text at read time (`researchExtractionIsStale`), and the two
   * differing means exactly "this result is older than the text it describes".
   */
  sourceFingerprint: z.string(),
});

export type ResearchExtractionRecord = z.infer<typeof researchExtractionRecordSchema>;

/** A material as this module reads it: title and text, plus the engine's segments when it has any. */
export type ResearchExtractionSource = {
  id: string;
  title: string;
  kind: string;
  sourceUrl: string;
  content: string;
  transcript: { segments: readonly TranscriptionSegmentRecord[] } | null;
};

/** Reads a stored extraction back; a row written by another build is `null` rather than a crash. */
export function parseResearchExtraction(value: unknown): ResearchExtractionRecord | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = researchExtractionRecordSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Reads the replaced versions back; entries this build cannot read are dropped, not guessed at. */
export function parseResearchExtractionHistory(value: unknown): ResearchExtractionRecord[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    const records: ResearchExtractionRecord[] = [];
    for (const entry of parsed) {
      const read = researchExtractionRecordSchema.safeParse(entry);
      if (read.success) records.push(read.data);
    }
    return records;
  } catch {
    return [];
  }
}

/**
 * The history one new version leaves behind: the version it replaced goes in front, oldest last.
 *
 * A material that never had a result keeps an empty history, and the cap keeps a regeneration loop from
 * growing the column without bound. Versions are identified by their revision, so a doubly-executed run
 * (which produces the same revision twice) cannot push one version in twice.
 */
export function researchExtractionHistoryWith(
  previous: ResearchExtractionRecord | null,
  history: readonly ResearchExtractionRecord[],
  nextRevision: number,
): ResearchExtractionRecord[] {
  const kept = history.filter((entry) => entry.revision !== previous?.revision);
  const withPrevious = previous && previous.revision !== nextRevision ? [previous, ...kept] : kept;
  return withPrevious.slice(0, researchExtractionHistoryLimit);
}

/** The revision the next result on this material carries: the current one plus one, or 1. */
export function nextResearchExtractionRevision(current: ResearchExtractionRecord | null) {
  return (current?.revision ?? 0) + 1;
}

/**
 * The text a run distils *and* the text an excerpt is checked against.
 *
 * One function for both, on purpose: "is this fact verified?" must be answered against exactly the text
 * the model was given - the material's own stored `content`, which is also the text a generation reads.
 * A transcript's segments are not added on top (they carry the same words plus the engine's marks, and
 * they are read only to *locate* an excerpt in time), so an edit of the text cannot leave verification
 * looking at a text the run never saw.
 */
export function researchExtractionSourceText(source: ResearchExtractionSource) {
  return source.content.trim();
}

/**
 * A cheap, stable fingerprint of the text a version was distilled from.
 *
 * FNV-1a over the whole text, prefixed with its length: no dependency, no crypto, identical on the
 * server and in the browser - which is what lets `researchExtractionIsStale()` be answered by a
 * component that only holds the material row.
 */
export function researchExtractionSourceFingerprint(text: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length}-${hash.toString(36)}`;
}

/** True when a stored result describes an older text than the one the material holds now. */
export function researchExtractionIsStale(record: ResearchExtractionRecord, source: ResearchExtractionSource) {
  return record.sourceFingerprint !== researchExtractionSourceFingerprint(researchExtractionSourceText(source));
}

/**
 * Whitespace is collapsed and the ends trimmed before an excerpt is looked for.
 *
 * A model that re-wraps an excerpt, or copies it out of a page whose line breaks differ, still said the
 * same words - so `\n` versus a space is not allowed to turn a real excerpt into an unverified one. What
 * is *not* bent: the characters themselves, in their order.
 */
function normalizeExcerpt(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

/** The shortest excerpt that may count as evidence: four characters, so a stray "OK" cannot pass. */
const minimumEvidenceLength = 4;

/**
 * Where an excerpt really sits in the source, or that it does not sit there at all.
 *
 * `verified` is the answer to "does the material's own text contain this excerpt?", and `at` is the
 * transcript mark of the first segment that contains it - a locator the model never supplies. A material
 * without segments (a page, a note) has no mark to give, and an unverified excerpt has neither, so
 * "未核实" is always the absence of a position rather than a placeholder time.
 */
export function researchExtractionEvidenceLocator(
  source: ResearchExtractionSource,
  excerpt: string,
): { verified: boolean; at: string } {
  const needle = normalizeExcerpt(excerpt);
  const haystack = normalizeExcerpt(researchExtractionSourceText(source));
  if (needle.length < minimumEvidenceLength || !haystack.includes(needle)) {
    return { verified: false, at: "" };
  }
  const segment = source.transcript?.segments.find((entry) => normalizeExcerpt(entry.text).includes(needle));
  return {
    verified: true,
    at: segment && segment.startMs !== null ? formatTranscriptTimestamp(segment.startMs) : "",
  };
}

/**
 * True when a model answer carried nothing a user could read.
 *
 * Such a run is `EXTRACTION_EMPTY`, never a stored result: an extraction that stored an empty record
 * would make "提炼完成" a claim about a row nobody can use.
 */
export function researchExtractionIsEmpty(output: ResearchExtractionOutput) {
  return (
    !output.summary.trim() &&
    output.keyPoints.every((point) => !point.trim()) &&
    output.facts.every((fact) => !fact.statement.trim()) &&
    output.quotes.every((quote) => !quote.trim()) &&
    output.topicSuggestions.every((suggestion) => !suggestion.title.trim())
  );
}

/** What a result holds, for the run's own success message and the dialog's counters. */
export function researchExtractionCounts(record: ResearchExtractionRecord) {
  return {
    keyPoints: record.keyPoints.length,
    facts: record.facts.length,
    quotes: record.quotes.length,
    topics: record.topicSuggestions.length,
    characters: record.summary.length,
  };
}

/** The `topics.source` value a topic created from a suggestion carries: where the idea came from. */
export const researchExtractionTopicSource = "research_extraction";

/**
 * What one material becomes when a run distils it.
 *
 * The same shape `researchMaterialPromptText()` chose for the writing prompt: a material is a title, a
 * source and a body, and the body is the record's own text - never a summary of it. The type of material
 * is named as well, because "this is a transcript" tells the model what kind of text it is reading (and
 * lets it say "没有可提取的数据" honestly instead of inventing figures).
 */
export function researchExtractionSourcePromptText(source: ResearchExtractionSource) {
  const text = researchExtractionSourceText(source);
  return [
    `研究素材：${source.title}`,
    source.sourceUrl.trim() ? `来源：${source.sourceUrl.trim()}` : "",
    `素材类型：${source.kind}`,
    text ? `正文：\n${text.slice(0, researchExtractionSourceLimit)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The system prompt of one extraction run: what to produce, and what not to pretend to know. */
export const researchExtractionSystemPrompt = [
  "你是一名严谨的研究助理。你会收到一份研究素材（网页正文、用户笔记或音视频逐字稿），请把它提炼成可复用的结构。",
  "规则：",
  "1. 摘要与核心观点必须忠于素材本身，不添加素材里没有的说法。",
  "2. 事实与数据只能来自素材；每条事实都要给出素材中的原文片段（逐字复制，不要改写、不要翻译、不要拼接）。找不到原文片段的，把 evidence 留空，绝不编造。",
  "3. 关键引述必须是素材中的原句，逐字复制。",
  "4. 选题建议是你基于素材提出的创作建议，属于你的推测，不是素材的事实；写在 topicSuggestions 里，不要混进摘要、事实或引述。",
  "5. 素材没有提到的数字、时间、人物、结论一律不写。素材不足以支撑某一项时，返回空数组。",
  "6. 输出的语言与素材本身的语言一致。",
  '只返回一个符合给定 JSON Schema 的 JSON 对象，不要输出 JSON 之外的任何文字。',
].join("\n");

/**
 * What a stored result becomes when it enters a *writing* prompt (P3-03-06).
 *
 * Three separations are kept here, because this is the one place a model's distillation is handed to
 * another model:
 *
 * - **The digest is labelled as a digest.** The block opens by saying these are AI-distilled notes from
 *   the material below, so an article cannot present them as its own reading of the page.
 * - **Only locatable excerpts travel with a fact.** A fact whose `evidence` is not in the material's own
 *   text is left out (`researchExtractionEvidenceLocator`), so an unverified claim never becomes an
 *   input a second model can repeat - and the number of facts left out is stated, so the caller can see
 *   that something was withheld rather than silently dropped.
 * - **Suggestions never travel.** `topicSuggestions` are the user's ideation, not source material.
 */
export function researchExtractionPromptText(
  record: ResearchExtractionRecord,
  source: ResearchExtractionSource,
): string {
  const verifiedFacts = record.facts
    .filter((fact) => researchExtractionEvidenceLocator(source, fact.evidence).verified)
    .slice(0, researchExtractionPromptLimits.facts);
  const verifiedQuotes = record.quotes
    .filter((quote) => researchExtractionEvidenceLocator(source, quote).verified)
    .slice(0, researchExtractionPromptLimits.quotes);
  const omittedFacts = record.facts.length - verifiedFacts.length;

  return [
    `研究提炼（AI 提炼自同一份素材，非素材原文；第 ${record.revision} 版）：`,
    record.summary.trim()
      ? `摘要：${record.summary.trim().slice(0, researchExtractionPromptLimits.summary)}`
      : "",
    record.keyPoints.length
      ? `核心观点：\n${record.keyPoints
          .slice(0, researchExtractionPromptLimits.keyPoints)
          .map((point) => `- ${point.trim()}`)
          .join("\n")}`
      : "",
    verifiedFacts.length
      ? `素材中的事实与数据（每条附原文片段）：\n${verifiedFacts
          .map((fact) => `- ${fact.statement.trim()}（原文：${fact.evidence.trim()}）`)
          .join("\n")}`
      : "",
    verifiedQuotes.length ? `素材中的关键引述：\n${verifiedQuotes.map((quote) => `- ${quote.trim()}`).join("\n")}` : "",
    omittedFacts > 0
      ? `（另有 ${omittedFacts} 条事实在素材原文中找不到对应片段，已省略，不得当作素材事实引用。）`
      : "",
    "以上内容只能作为素材的提炼使用：不得把其中任何一条说成素材原文没有写明的事实。",
  ]
    .filter(Boolean)
    .join("\n");
}
