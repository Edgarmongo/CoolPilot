import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchExtractionRecord } from "@/lib/research-extraction/extraction";

/**
 * `/api/research/<id>/extraction` - the read, the run and the edit of one material's 研究提炼 (CI-P3-03).
 *
 * Three contracts are the point of this file:
 *
 * - **`GET` answers the stored record, not the run.** It carries the current version, the versions it
 *   replaced, and `stale` computed from the material's own text - so the dialog never has to guess whether
 *   the result still describes the text.
 * - **`POST` creates a task and starts it**, and refuses *before* creating one when there is nothing to
 *   distil (no text) or nobody to distil (no material). `reused` is what a second submission is told.
 * - **`PATCH` edits the current version only.** It cannot create one, cannot move `revision` / `taskId`,
 *   and cannot touch the material's own `content`.
 *
 * The temp database and the keyless runtime come from `@/test/route-harness`, which has to be the first
 * `await` here (it pins the environment before anything that reads it loads). No model is prepared in this
 * file on purpose: the run the route starts fails fast on "no model is configured", which is the task
 * system's own answer and not this route's, and it keeps these cases about the route's *own* contract.
 */

const { resetRuntime } = await import("@/test/route-harness");
const { GET, PATCH, POST } = await import("./route");
const {
  createResearchMaterial,
  getResearchMaterial,
  listResearchMaterials,
  saveResearchExtraction,
  updateResearchMaterial,
} = await import("@/db/repositories/research");
const { getRun, listRuns } = await import("@/db/repository");
const { researchExtractionSourceFingerprint } = await import("@/lib/research-extraction/extraction");
const { sqlite } = await import("@/db/client");

const sourceText = "七点以后冰饮最好卖，夜市摊位比商场高 40%。";

/** The stored result one run would have written for `sourceText`. */
function storedExtraction(
  materialId: string,
  overrides: Partial<ResearchExtractionRecord> = {},
): ResearchExtractionRecord {
  return {
    summary: "夜市比商场更好卖。",
    keyPoints: ["七点以后是高峰"],
    facts: [{ statement: "夜市比商场高 40%", evidence: "夜市摊位比商场高 40%" }],
    quotes: ["七点以后冰饮最好卖"],
    topicSuggestions: [{ title: "夜市冰饮选品指南", rationale: "出单数据支持这个方向。" }],
    revision: 1,
    taskId: "task-1",
    providerId: "qwen",
    model: "qwen3-max",
    generatedAt: 1_700_000_000_000,
    editedAt: null,
    materialId,
    materialTitle: "夏季冰饮动销报告",
    materialKind: "url",
    sourceUrl: "https://example.com/research/summer-drinks",
    sourceCharacters: sourceText.length,
    sourceFingerprint: researchExtractionSourceFingerprint(sourceText),
    ...overrides,
  };
}

async function materialWithText(overrides: Record<string, unknown> = {}) {
  const material = await createResearchMaterial({
    title: "夏季冰饮动销报告",
    kind: "url",
    sourceUrl: "https://example.com/research/summer-drinks",
    content: sourceText,
    ...overrides,
  });
  if (!material) throw new Error("the material fixture was not created");
  return material;
}

/** The second argument a dynamic route handler takes in this build. */
function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

/**
 * One `POST`. The body is always JSON - `{}` when the case has nothing to ask for - because that is what
 * this route's payload guard expects of every caller (the dialog sends the same empty object).
 */
function submit(id: string, body: unknown = {}) {
  return POST(
    new Request("http://localhost/api/research/x/extraction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    context(id),
  );
}

describe("/api/research/[id]/extraction", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await resetRuntime();
    await sqlite.execute({ sql: "DELETE FROM research_materials" });
    await sqlite.execute({ sql: "DELETE FROM run_events" });
    await sqlite.execute({ sql: "DELETE FROM runs" });
  });

  it("answers the stored result, its earlier versions and whether it is still current", async () => {
    const material = await materialWithText();

    // A material nobody has distilled reads as "no result" - a different statement from an empty one,
    // because an empty result never gets stored at all.
    const before = await GET(new Request("http://localhost/api/research/x/extraction"), context(material.id));
    await expect(before.json()).resolves.toMatchObject({
      data: { materialId: material.id, extraction: null, history: [], stale: false },
    });

    await saveResearchExtraction(material.id, storedExtraction(material.id));
    const after = await GET(new Request("http://localhost/api/research/x/extraction"), context(material.id));
    const payload = await after.json();

    expect(after.status).toBe(200);
    expect(payload.data.extraction).toMatchObject({ revision: 1, summary: "夜市比商场更好卖。" });
    // A result generated from this very text is not stale...
    expect(payload.data.stale).toBe(false);
    // ...and the material's own version number is reported next to it (the number an article records).
    expect(payload.data.materialVersion).toBe((await getResearchMaterial(material.id))?.updatedAt);

    // Editing the material's text makes the stored version visibly older than what it describes.
    await updateResearchMaterial(material.id, { content: `${sourceText}补一句。` });
    const edited = await GET(new Request("http://localhost/api/research/x/extraction"), context(material.id));
    await expect(edited.json()).resolves.toMatchObject({ data: { stale: true } });
  });

  it("answers 404 for a material that is not there", async () => {
    const response = await GET(new Request("http://localhost/api/research/gone/extraction"), context("gone"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("creates and starts a distillation task for a material with text", async () => {
    const material = await materialWithText();

    const response = await submit(material.id);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data.lookup).toBe(`/api/tasks/${payload.data.taskId}`);
    expect(payload.data.reused).toBe(false);
    // A real row of the existing task system: one `runs` row, no extraction table of its own.
    const run = await getRun(payload.data.taskId);
    expect(run?.playbookId).toBe("research_extraction");
    expect(run?.params).toMatchObject({ materialId: material.id });
    expect(payload.data.task?.type).toBe("research_extraction");
  });

  it("tells a resubmission with the same key that its task already exists", async () => {
    const material = await materialWithText();
    const request = () =>
      new Request("http://localhost/api/research/x/extraction", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: "distil-once" }),
      });

    const first = await POST(request(), context(material.id));
    const second = await POST(request(), context(material.id));
    const firstPayload = await first.json();
    const secondPayload = await second.json();

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(secondPayload.data.reused).toBe(true);
    expect(secondPayload.data.taskId).toBe(firstPayload.data.taskId);
    expect((await listRuns(50)).filter((run) => run.playbookId === "research_extraction")).toHaveLength(1);
  });

  it("refuses a material with nothing to distil instead of creating a task nobody can finish", async () => {
    const blank = await materialWithText({ title: "还没读的网页", content: "" });

    const response = await submit(blank.id);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "INVALID_PAYLOAD",
      details: { code: "MATERIAL_EMPTY" },
    });
    expect(await listRuns(50)).toEqual([]);
  });

  it("answers 404 for a material that is gone, and 400 for a body that is not JSON", async () => {
    const missing = await submit("no-such-material");
    expect(missing.status).toBe(404);

    const material = await materialWithText();
    const broken = await POST(
      new Request("http://localhost/api/research/x/extraction", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
      context(material.id),
    );
    expect(broken.status).toBe(400);
    await expect(broken.json()).resolves.toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
  });

  it("saves the user's edit of the current version without touching the material or the run", async () => {
    const material = await materialWithText();
    await saveResearchExtraction(material.id, storedExtraction(material.id));

    const response = await PATCH(
      new Request("http://localhost/api/research/x/extraction", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          summary: "夜市仍是主场（已人工修订）。",
          keyPoints: ["七点以后是高峰", "夜市比商场高 40%"],
          facts: [{ statement: "夜市摊位比商场高 40%", evidence: "夜市摊位比商场高 40%" }],
          quotes: ["七点以后冰饮最好卖"],
        }),
      }),
      context(material.id),
    );
    const saved = (await response.json()).data;

    expect(response.status).toBe(200);
    expect(saved).toMatchObject({
      summary: "夜市仍是主场（已人工修订）。",
      keyPoints: ["七点以后是高峰", "夜市比商场高 40%"],
      // The run is still the version it produced: an edit is not a new generation.
      revision: 1,
      taskId: "task-1",
      model: "qwen3-max",
    });
    expect(typeof saved.editedAt).toBe("number");

    const stored = await getResearchMaterial(material.id);
    expect(stored?.content).toBe(sourceText);
    expect(stored?.extractionHistory).toEqual([]);
    // What was saved is what a re-read answers: the edit is persisted, not merely returned.
    const reread = await GET(new Request("http://localhost/api/research/x/extraction"), context(material.id));
    await expect(reread.json()).resolves.toMatchObject({
      data: { extraction: { summary: "夜市仍是主场（已人工修订）。", editedAt: saved.editedAt } },
    });
  });

  it("refuses an empty edit, an edit of nothing, and an edit that is not a payload", async () => {
    const material = await materialWithText();
    const edit = (body: string) =>
      new Request("http://localhost/api/research/x/extraction", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body,
      });

    // Nothing has been distilled yet: there is no version to edit, and inventing one from a patch is
    // exactly the phantom result this card refuses.
    const nothing = await PATCH(edit(JSON.stringify({ summary: "凭空写的摘要" })), context(material.id));
    expect(nothing.status).toBe(404);
    expect((await getResearchMaterial(material.id))?.extraction).toBeNull();

    await saveResearchExtraction(material.id, storedExtraction(material.id));
    const empty = await PATCH(edit("{}"), context(material.id));
    expect(empty.status).toBe(400);
    await expect(empty.json()).resolves.toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });

    // A field the record does not have is not an edit of it either: the patch is built from the schema the
    // model answers, so an unknown key cannot sneak into the stored record.
    const unknown = await PATCH(edit(JSON.stringify({ revision: 99 })), context(material.id));
    expect(unknown.status).toBe(400);
    expect((await getResearchMaterial(material.id))?.extraction?.revision).toBe(1);
    expect(await listResearchMaterials()).toHaveLength(1);
  });
});
