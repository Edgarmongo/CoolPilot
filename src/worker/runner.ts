import path from "node:path";
import {
  appendRunEvent,
  createContentItem,
  getRun,
  getAccount,
  listRunEvents,
  markRunPaused,
  updateRunStatus,
} from "@/db/repository";
import { getLocalAgentSettings } from "@/db/repositories/settings";
import { browserProfilesRoot } from "@/lib/paths";
import { beginAiBudgetNode, isAiBudgetRefusal } from "@/lib/ai-budget-guard";
import {
  budgetPauseEventData,
  budgetPauseFromTaskRefusal,
  budgetPauseMessage,
  budgetPauseOf,
  readBudgetPauseMarker,
  type BudgetPauseGate,
  type BudgetPauseRecord,
} from "@/lib/run-budget-pause";
import { fetchArticleText, generateTopicPost, rewriteArticle, searchGoogleNews } from "@/lib/scraper";
import { postNextThreadsContent, type ThreadsPostMode } from "@/lib/threads";
import { executeResearchExtractionTask } from "@/lib/research-extraction/extraction-task";
import { executeTranscriptionTask } from "@/lib/transcription/transcription-task";
import { executeVideoRenderTask } from "@/lib/videos/video-render-task";
import type { AutomationContext, RunRecord } from "@/lib/types";

/**
 * CI-P7-03-B. How far a run has got, kept where the *steps* are so a refusal can name the step it
 * refused and count the ones already done.
 *
 * `processRun` owns one of these and hands it to the playbook, which updates it as it walks: the URL
 * importer sets it at the head of every URL, the head-gated playbooks simply keep `pendingStep` at the
 * playbook's own name. That is what makes the pause record's checkpoint the truth about *this* run
 * rather than a number parsed out of a log line.
 */
type RunProgress = { completedSteps: number; pendingStep: string; stepIndex: number | null };

/**
 * A refusal raised *at* a step, travelling with the record a resume needs.
 *
 * It is an exception rather than a return value because that is how the gate already speaks: the check
 * throws, and every step of every playbook would otherwise have to grow a branch for it.
 */
class RunBudgetPause extends Error {
  readonly pause: BudgetPauseRecord;

  constructor(pause: BudgetPauseRecord) {
    super(budgetPauseMessage(pause));
    this.name = "RunBudgetPause";
    this.pause = pause;
  }
}

/**
 * A refusal that arrived as a playbook's own code rather than as the gate's `AppError`:
 * `research_extraction` maps `AI_BUDGET_EXCEEDED` onto `BUDGET_EXCEEDED` inside its task.
 */
class StepBudgetRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StepBudgetRefusal";
  }
}

/**
 * CI-P7-03-B, in one function: run the step gate, and turn its refusal into a pause.
 *
 * The check itself is unchanged from CI-P7-03 - the same `beginAiBudgetNode`, the same decision row, the
 * same `AI_BUDGET_EXCEEDED` arithmetic - and only the *answer* to a "no" changed: the run stands still
 * on the checkpoint it had reached instead of being failed. Errors that are not a refusal (a settings or
 * ledger read that broke) keep travelling as themselves, because a broken read is not a budget decision.
 */
async function stepGate(
  run: RunRecord,
  purpose: string,
  gate: BudgetPauseGate,
  progress: RunProgress,
) {
  try {
    await beginAiBudgetNode({ purpose, identity: { runId: run.id } });
  } catch (error) {
    if (!isAiBudgetRefusal(error)) throw error;
    throw new RunBudgetPause(
      budgetPauseOf(error, {
        gate,
        purpose,
        pendingStep: progress.pendingStep,
        completedSteps: progress.completedSteps,
        stepIndex: progress.stepIndex,
      }),
    );
  }
}

function stringParam(params: Record<string, unknown>, key: string, fallback = "") {
  const value = params[key];
  return typeof value === "string" ? value : fallback;
}

function booleanParam(params: Record<string, unknown>, key: string, fallback = false) {
  const value = params[key];
  return typeof value === "boolean" ? value : fallback;
}

function numberParam(params: Record<string, unknown>, key: string, fallback: number) {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function urlList(params: Record<string, unknown>) {
  const raw = params.urls ?? params.url;
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === "string" && /^https?:\/\//.test(item));
  }
  if (typeof raw === "string") {
    return raw
      .split(/[\r\n,]+/)
      .map((item) => item.trim())
      .filter((item) => /^https?:\/\//.test(item));
  }
  return [];
}

async function makeContext(run: RunRecord): Promise<AutomationContext> {
  const site = run.accountId ? await getAccount(run.accountId) : undefined;
  return {
    runId: run.id,
    site: site ?? undefined,
    params: run.params,
    profilePath: site?.profilePath ?? path.join(browserProfilesRoot(), "default"),
    log: async (message, level = "info") => {
      await appendRunEvent(run.id, message, level);
    },
    checkStop: async () => {
      const latest = await getRun(run.id);
      return latest?.status === "cancelled";
    },
  };
}

/**
 * CI-P7-03. The playbooks whose whole point is a model call, and therefore the ones the *step* gate
 * covers before the first request of the run is even built.
 *
 * The two URL importers are deliberately not here: their steps spend only when `rewrite` is true, so
 * they are gated per URL inside `runUrlImporter`, where that flag is known - an import that rewrites
 * nothing is free and must not be refused for a budget it never touches. `threads_auto_post`,
 * `threads_compose_post`, `video_render` and `media_transcription` are not here for the same reason at
 * the playbook level: their AI (image resolution) goes through the per-call gate, and refusing a free
 * publish or a local transcription because the AI budget is empty would be a refusal this gate cannot
 * back up.
 *
 * CI-P7-03-B left the membership alone and changed what a refusal does: since this gate runs at the head
 * of the run, nothing of the playbook has happened yet, so a refusal here is a pause whose checkpoint is
 * the playbook's own first step - a resume re-runs exactly that and nothing was wasted.
 */
const aiSpendingPlaybooks = new Set([
  "topic_article_generator",
  "ai_prompt_proxy",
  "topic_search_writer",
  "research_extraction",
]);

/**
 * CI-P7-03-B. The playbooks a budget refusal may *pause* rather than fail.
 *
 * Not "every playbook that can spend": the publishing playbooks (`threads_auto_post`,
 * `threads_compose_post`) spend too - resolving an image - but a resume re-walks the playbook from its
 * checkpoint, and no checkpoint here can promise that re-walking a publish step is free of platform side
 * effects. Their refusal therefore keeps failing the run and keeps saying so, exactly as CI-P7-03 left it:
 * a pause the console cannot honour is worse than an honest failure.
 *
 * What is left is the AI-only playbooks, plus the two URL importers whose per-URL gate CI-P7-03 put
 * inside `runUrlImporter`. Every refusal point in them sits **before** the step that stores anything - the
 * content item is created after the rewrite, the distillation's material is written after the model
 * answers - so a resume re-does only the refused step and creates nothing twice.
 */
const budgetPausablePlaybooks = new Set<string>([
  ...aiSpendingPlaybooks,
  "article_scraper_rewriter",
  "ai_url_extractor",
]);

/**
 * CI-P7-03-B. The pause itself: one `warn` event carrying the whole record, and a status that says the run
 * is standing still.
 *
 * The record goes in the *event*, not in a column, so the newest marker a run carries is always the answer
 * to "may I resume, and from where" - and it survives a restart, because reading it back is reading the
 * run's own log. There is no `error` event and no `finishedAt`: a run waiting on a budget is not a run
 * that failed, and the failure wording would be the one thing a resume could not retract.
 */
async function pauseRun(run: RunRecord, pause: BudgetPauseRecord) {
  const message = budgetPauseMessage(pause);
  await appendRunEvent(run.id, message, "warn", budgetPauseEventData(pause));
  await markRunPaused(run.id, message);
}

async function runTopicGenerator(run: RunRecord, ctx: AutomationContext) {
  const topic = stringParam(run.params, "topic") || stringParam(run.params, "prompt");
  if (!topic) {
    throw new Error("Missing topic");
  }
  await ctx.log(`開始 AI 生文：${topic}`);
  const generated = await generateTopicPost({
    topic,
    keywords: stringParam(run.params, "keywords"),
    maxWords: numberParam(run.params, "maxWords", 300),
    language: stringParam(run.params, "language", "简体中文"),
    prompt: stringParam(run.params, "prompt"),
    runId: ctx.runId,
  });
  const item = await createContentItem({
    title: generated.title,
    body: generated.body,
    postReadyText: generated.postReadyText,
    sourceUrls: [],
    status: "ready",
  });
  await ctx.log(`已建立素材：${item.title} (${generated.provider}/${generated.model})`, "success");
  return `Created content item ${item.id}`;
}

async function runUrlImporter(
  run: RunRecord,
  ctx: AutomationContext,
  progress: RunProgress,
  resumeFrom: BudgetPauseRecord | null,
) {
  const urls = urlList(run.params);
  if (urls.length === 0) {
    throw new Error("Missing URL");
  }

  // CI-P7-03-B. A resumed run starts where the pause stopped: the URLs that were already imported are
  // the pause record's own `completedSteps`, and they are *not* fetched, rewritten or stored again. The
  // count is capped at the list length so a record from a run whose parameters changed cannot index past
  // the end - it skips at most the whole list, and then imports nothing.
  const skipped = Math.min(Math.max(resumeFrom?.completedSteps ?? 0, 0), urls.length);
  if (skipped > 0) {
    await ctx.log(`續跑：前 ${skipped} 個 URL 已完成，不再重做。`, "warn");
  }

  let count = 0;
  for (let index = skipped; index < urls.length; index += 1) {
    const url = urls[index];
    // The checkpoint this iteration would be refused at: `index` steps are done, and this URL is the
    // step that has not run. Set before the gate so the record is the truth whichever gate speaks.
    progress.completedSteps = index;
    progress.pendingStep = url;
    progress.stepIndex = index;
    await ctx.log(`抓取 URL：${url}`);
    const rewrite = booleanParam(run.params, "rewrite", true);
    // CI-P7-03. Each URL is a step of this playbook, so the gate runs at the head of every iteration:
    // a run that is already over budget stops instead of walking the rest of the list. Since CI-P7-03-B
    // that stop is a pause carrying this URL's own index, not a failure. `rewrite: false` spends nothing
    // and is not gated.
    if (rewrite) {
      // CI-P7-03-A: the step's own identity travels with the decision, so "which run stopped here" is a
      // filter on the budget records rather than a guess from the purpose string.
      await stepGate(run, `run:${run.playbookId}:url`, "node", progress);
    }
    const article = await fetchArticleText(url);
    const content = rewrite
      ? await rewriteArticle({
          title: article.title || url,
          text: article.text,
          maxWords: numberParam(run.params, "maxWords", 300),
          language: stringParam(run.params, "language", "简体中文"),
          prompt: stringParam(run.params, "prompt"),
          runId: ctx.runId,
        })
      : {
          title: article.title || url,
          body: article.text.slice(0, numberParam(run.params, "maxWords", 300) * 2),
          postReadyText: article.text.slice(0, numberParam(run.params, "maxWords", 300) * 2),
        };
    await createContentItem({
      title: content.title,
      body: content.body,
      postReadyText: content.postReadyText,
      sourceUrls: [url],
      imagePath: article.imageUrl,
      status: "ready",
    });
    count += 1;
    progress.completedSteps = index + 1;
  }
  await ctx.log(`URL 匯入完成：${count} 篇`, "success");
  return skipped > 0 ? `Imported ${count} URL(s) (resumed after ${skipped})` : `Imported ${count} URL(s)`;
}

async function runTopicSearch(run: RunRecord, ctx: AutomationContext) {
  const topic = stringParam(run.params, "topic");
  if (!topic) {
    throw new Error("Missing topic");
  }
  const maxItems = numberParam(run.params, "articleCount", 3);
  const news = await searchGoogleNews(topic, maxItems);
  if (news.length === 0) {
    throw new Error("No Google News RSS result");
  }
  await ctx.log(`Google News 找到 ${news.length} 篇，開始整理。`);

  const sourceText = news
    .map((item, index) => `${index + 1}. ${item.title}\n${item.description}\n${item.link}`)
    .join("\n\n");
  const generated = await generateTopicPost({
    topic,
    keywords: stringParam(run.params, "keywords"),
    maxWords: numberParam(run.params, "maxWords", 300),
    language: stringParam(run.params, "language", "简体中文"),
    prompt: `${stringParam(run.params, "prompt")}\n\n請根據以下新聞摘要整理：\n${sourceText}`,
    runId: ctx.runId,
  });
  const item = await createContentItem({
    title: generated.title,
    body: generated.body,
    postReadyText: generated.postReadyText,
    sourceUrls: news.map((item) => item.link).filter(Boolean),
    status: "ready",
  });
  await ctx.log(`已建立新聞素材：${item.title}`, "success");
  return `Created news content item ${item.id}`;
}

async function runThreads(run: RunRecord, ctx: AutomationContext) {
  if (!ctx.site) {
    throw new Error("Threads run requires accountId");
  }
  const settings = await getLocalAgentSettings();
  const result = await postNextThreadsContent({
    site: ctx.site,
    ctx,
    allowNoImage: booleanParam(run.params, "allowNoImage", true),
    appendText: stringParam(run.params, "appendText"),
    postMode: stringParam(run.params, "postMode", "title_body") as ThreadsPostMode,
    confirmLivePost: booleanParam(run.params, "scheduledPublishAuthorized", false)
      || booleanParam(run.params, "confirmLivePost", false)
      || settings.agentPermissions.browserPostContent === "auto",
    contentItemId: stringParam(run.params, "contentItemId"),
  });
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.message;
}

async function runComposePost(run: RunRecord, ctx: AutomationContext) {
  const composeText = stringParam(run.params, "composeText");
  if (composeText) {
    const item = await createContentItem({
      title: composeText.split("\n")[0]?.slice(0, 80) || "Threads draft",
      body: composeText,
      postReadyText: composeText,
      sourceUrls: [],
      imagePath: stringParam(run.params, "composeImage"),
      status: "ready",
    });
    await ctx.log(`已儲存草稿素材：${item.id}`, "success");
    return `Saved compose draft ${item.id}`;
  }
  return runThreads(run, ctx);
}

/**
 * CI-P1-04: the video render playbook.
 *
 * The tool entry creates a render task and runs it inside the same call, so this case is what happens to
 * a `video_render` row that was queued elsewhere (`POST /api/runs`, a schedule) and claimed by a worker:
 * the *same* executor runs - there is no second implementation of a render here - and its outcome is what
 * the run ends up reporting. A refusal is thrown so `processRun` records `failed` like it does for every
 * other playbook, and a success message names the deliverable; the address of the deliverable is also in
 * the task's own success event.
 */
async function runVideoRender(run: RunRecord) {
  const outcome = await executeVideoRenderTask(run.id);
  if (outcome.kind === "succeeded") {
    return `Video render succeeded: ${outcome.artifacts.video.fileName}`;
  }
  if (outcome.kind === "failed") throw new Error(outcome.failure.message);
  return `Video render skipped: ${outcome.reason}`;
}

/**
 * CI-P3-02: the media transcription playbook.
 *
 * The API entry creates a transcription task and runs it in-process (a transcript takes minutes, so the
 * request must not hold it), and this case is what happens to a `media_transcription` row that was queued
 * elsewhere - `POST /api/runs`, a schedule - and claimed by a worker: the *same* executor runs, so there
 * is no second transcription implementation to drift from the first. A refusal is thrown so `processRun`
 * records `failed` with the engine's own code, and a success names the material that now holds the
 * transcript, which is the deliverable a caller reads out of the task rather than out of a guess.
 */
async function runTranscription(run: RunRecord) {
  const outcome = await executeTranscriptionTask(run.id);
  if (outcome.kind === "succeeded") {
    return `Transcript of "${String(outcome.run.params.sourceFileName ?? "")}" stored as research material ${outcome.materialId}`;
  }
  if (outcome.kind === "failed") throw new Error(outcome.failure.message);
  return `Transcription skipped: ${outcome.reason}`;
}

/**
 * CI-P3-03: the research-distillation playbook.
 *
 * The API entry creates a distillation task and runs it in-process (a model call over a long text, so the
 * request must not hold it), and this case is what happens to a `research_extraction` row that was queued
 * elsewhere - `POST /api/runs`, a schedule - and claimed by a worker: the *same* executor runs, so there
 * is no second distillation implementation to drift from the first. A refusal is thrown so `processRun`
 * records `failed` with the task's own code, and a success names the version the material now carries.
 *
 * CI-P7-03-B splits the refusals the task can answer with: a budget refusal (`BUDGET_EXCEEDED`, which the
 * task itself mapped from the gate's own error) is *not* a distillation failure and is re-thrown as
 * `StepBudgetRefusal` so `processRun` pauses the run instead of failing it. The task cannot pause on its
 * own: it is also driven by the API route, where the run is one distillation call and there is nothing to
 * resume from a checkpoint.
 */
async function runResearchExtraction(run: RunRecord) {
  const outcome = await executeResearchExtractionTask(run.id);
  if (outcome.kind === "succeeded") {
    return `Distilled research material ${outcome.materialId} into version ${outcome.extraction.revision}`;
  }
  if (outcome.kind === "failed") {
    if (outcome.failure.code === "BUDGET_EXCEEDED") throw new StepBudgetRefusal(outcome.failure.message);
    throw new Error(outcome.failure.message);
  }
  return `Distillation skipped: ${outcome.reason}`;
}

export async function processRun(run: RunRecord) {
  const ctx = await makeContext(run);
  // CI-P7-03-B. Where this run has got to, in the terms a pause record needs. The head-gated playbooks
  // never move it past their own name; the URL importers set it at the head of every URL.
  const progress: RunProgress = { completedSteps: 0, pendingStep: run.playbookId, stepIndex: null };
  try {
    // CI-P7-03-B. What the run's own log says about its last pause, if any. The checkpoint lives in the
    // event stream rather than in a column or in memory, so a resume after a restart reads the same answer
    // as a resume a second later - and the *newest* marker is the one that decides.
    const resume = readBudgetPauseMarker(await listRunEvents(run.id)).resume;
    await ctx.log(
      resume
        ? `續跑 ${run.playbookId}：自「${resume.from.pendingStep}」繼續，已完成 ${resume.from.completedSteps} 個步驟。`
        : `開始執行 ${run.playbookId}`,
    );
    // CI-P7-03. The step gate: before the run builds its first request, ask whether this period still has
    // budget at all. Since CI-P7-03-B a refusal here *pauses* the run instead of failing it - and because
    // this gate runs before the playbook's first step, the checkpoint it pauses on is that first step, so a
    // resume asks the budget again and carries on from the top when the money is there.
    if (aiSpendingPlaybooks.has(run.playbookId)) {
      await stepGate(run, `run:${run.playbookId}`, "node", progress);
    }
    let message: string;
    switch (run.playbookId) {
      case "topic_article_generator":
      case "ai_prompt_proxy":
        message = await runTopicGenerator(run, ctx);
        break;
      case "article_scraper_rewriter":
      case "ai_url_extractor":
        message = await runUrlImporter(run, ctx, progress, resume?.from ?? null);
        break;
      case "topic_search_writer":
        message = await runTopicSearch(run, ctx);
        break;
      case "threads_auto_post":
        message = await runThreads(run, ctx);
        break;
      case "threads_compose_post":
        message = await runComposePost(run, ctx);
        break;
      case "video_render":
        message = await runVideoRender(run);
        break;
      case "media_transcription":
        message = await runTranscription(run);
        break;
      case "research_extraction":
        message = await runResearchExtraction(run);
        break;
      default:
        throw new Error(`Unsupported playbook: ${run.playbookId}`);
    }
    const status = message.toLowerCase().includes("dry run") ? "warning" : "success";
    await updateRunStatus(run.id, status, message);
    await ctx.log(`完成：${message}`, status === "warning" ? "warn" : "success");
  } catch (error) {
    // CI-P7-03-B. A refusal *at* a step: the run stops where it stands, keeping everything it has already
    // produced, and says which step it stopped at. This is the whole point of the pause - the completed
    // URLs, the stored material and the finished steps are not undone to answer a budget question.
    if (error instanceof RunBudgetPause) {
      await pauseRun(run, error.pause);
      return;
    }
    // A refusal from a *call* gate inside a step - the rewrite's own model call, the distillation's -
    // arrives as the gate's error, without the record a step gate builds. The run's live progress is
    // exactly what is needed to build one: the step that has not run is still the truth.
    if (isAiBudgetRefusal(error) && budgetPausablePlaybooks.has(run.playbookId)) {
      await pauseRun(
        run,
        budgetPauseOf(error, {
          gate: "call",
          purpose: `run:${run.playbookId}`,
          pendingStep: progress.pendingStep,
          completedSteps: progress.completedSteps,
          stepIndex: progress.stepIndex,
        }),
      );
      return;
    }
    // `research_extraction` answers with the task's own code rather than the gate's error, so the
    // arithmetic is gone by the time it is read here. The refusal is real and the run pauses; what is
    // missing is the numbers, and they are `null` rather than zero.
    if (error instanceof StepBudgetRefusal) {
      await pauseRun(
        run,
        budgetPauseFromTaskRefusal({
          gate: "call",
          purpose: `run:${run.playbookId}`,
          pendingStep: progress.pendingStep,
          completedSteps: progress.completedSteps,
          stepIndex: progress.stepIndex,
          code: "BUDGET_EXCEEDED",
        }),
      );
      return;
    }
    const message = (error as Error).message;
    await ctx.log(message, "error");
    await updateRunStatus(run.id, "failed", message);
  }
}
