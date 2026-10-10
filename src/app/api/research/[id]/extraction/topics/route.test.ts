import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchExtractionRecord } from "@/lib/research-extraction/extraction";

/**
 * `POST /api/research/<id>/extraction/topics` - turning one 选题建议 into a real topic (CI-P3-03-06).
 *
 * What these cases pin is that the hand-off is a *hand-off*: the topic is created through the ordinary
 * topic repository, it records which material the idea came from, and nothing of the material's text
 * travels with it. An idea is not a source fact, so a topic built from one is the user's own topic from
 * that moment on.
 */

const { resetRuntime } = await import("@/test/route-harness");
const { POST } = await import("./route");
const { createResearchMaterial, saveResearchExtraction } = await import("@/db/repositories/research");
const { listTopics } = await import("@/db/repositories/topics");
const { researchExtractionTopicSource } = await import("@/lib/research-extraction/extraction");
const { sqlite } = await import("@/db/client");

/** A stored result whose two suggestions are distinguishable, so the index is what picks one. */
function storedExtraction(
  materialId: string,
  topicSuggestions: ResearchExtractionRecord["topicSuggestions"],
): ResearchExtractionRecord {
  return {
    summary: "夜市比商场更好卖。",
    keyPoints: ["七点以后是高峰"],
    facts: [{ statement: "夜市比商场高 40%", evidence: "夜市摊位比商场高 40%" }],
    quotes: ["七点以后冰饮最好卖"],
    topicSuggestions,
    revision: 2,
    taskId: "task-2",
    providerId: "qwen",
    model: "qwen3-max",
    generatedAt: 1_700_000_000_000,
    editedAt: null,
    materialId,
    materialTitle: "夏季冰饮动销报告",
    materialKind: "url",
    sourceUrl: "https://example.com/research/summer-drinks",
    sourceCharacters: 20,
    sourceFingerprint: "20-abc",
  };
}

const suggestions = [
  { title: "夜市冰饮选品指南", rationale: "出单数据支持这个方向。" },
  { title: "商场冰饮为什么卖不动", rationale: "和夜市的对比就是切口。" },
];

function request(body: unknown) {
  return new Request("http://localhost/api/research/x/extraction/topics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("/api/research/[id]/extraction/topics", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await resetRuntime();
    await sqlite.execute({ sql: "DELETE FROM research_materials" });
    await sqlite.execute({ sql: "DELETE FROM topics" });
  });

  it("creates the topic the index names, recording where the idea came from", async () => {
    const material = await createResearchMaterial({
      title: "夏季冰饮动销报告",
      kind: "url",
      sourceUrl: "https://example.com/research/summer-drinks",
      content: "七点以后冰饮最好卖。",
    });
    if (!material) throw new Error("the material fixture was not created");
    await saveResearchExtraction(material.id, storedExtraction(material.id, suggestions));

    const response = await POST(request({ index: 1 }), context(material.id));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data).toMatchObject({
      extractionRevision: 2,
      topic: {
        title: "商场冰饮为什么卖不动",
        description: "和夜市的对比就是切口。",
        source: researchExtractionTopicSource,
        sourceUrl: material.sourceUrl,
        researchMaterialId: material.id,
        status: "active",
      },
    });
    // A real row in the topic library, not a copy kept beside the extraction.
    const topics = await listTopics();
    expect(topics.map((topic) => topic.id)).toEqual([payload.data.topic.id]);
    expect(topics[0]?.researchMaterialId).toBe(material.id);
    // The material's own text never travelled: a suggestion is an idea, not material.
    expect(JSON.stringify(payload.data.topic)).not.toContain("七点以后冰饮最好卖");
  });

  it("refuses an index that names nothing instead of creating the wrong topic", async () => {
    const material = await createResearchMaterial({ title: "夏季冰饮动销报告", content: "七点以后冰饮最好卖。" });
    if (!material) throw new Error("the material fixture was not created");
    await saveResearchExtraction(material.id, storedExtraction(material.id, suggestions));

    const response = await POST(request({ index: 5 }), context(material.id));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "INVALID_PAYLOAD",
      details: { index: 5, available: 2 },
    });
    expect(await listTopics()).toEqual([]);
  });

  it("refuses a suggestion with no title, because a topic needs one", async () => {
    const material = await createResearchMaterial({ title: "夏季冰饮动销报告", content: "七点以后冰饮最好卖。" });
    if (!material) throw new Error("the material fixture was not created");
    await saveResearchExtraction(
      material.id,
      storedExtraction(material.id, [{ title: "   ", rationale: "只有理由。" }]),
    );

    const response = await POST(request({ index: 0 }), context(material.id));

    expect(response.status).toBe(400);
    expect(await listTopics()).toEqual([]);
  });

  it("refuses a material with no result, and a material that is not there", async () => {
    const undistilled = await createResearchMaterial({ title: "还没提炼的素材", content: "七点以后冰饮最好卖。" });
    if (!undistilled) throw new Error("the material fixture was not created");

    const nothing = await POST(request({ index: 0 }), context(undistilled.id));
    expect(nothing.status).toBe(404);
    await expect(nothing.json()).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });

    const gone = await POST(request({ index: 0 }), context("no-such-material"));
    expect(gone.status).toBe(404);

    // An index that is not a number is not a request this entry answers either.
    const invalid = await POST(request({ index: -1 }), context(undistilled.id));
    expect(invalid.status).toBe(400);
    expect(await listTopics()).toEqual([]);
  });
});
