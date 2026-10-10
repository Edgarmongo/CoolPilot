import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * `POST /api/research/upload` (CI-P3-01 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * The file path reuses the knowledge library's reader (`@/lib/knowledge-file`), so this file pins what is
 * *different* about importing a research material rather than re-testing the extractor:
 *
 * - a file that yields text becomes a `ready` file material whose title is the file name without its
 *   extension, and whose `fileName` keeps the real one;
 * - a supported file that yields *no* text becomes an `empty` material instead of a refusal, so the reason
 *   is on a record the user can see rather than in a dialog that closed;
 * - a type neither this route nor the knowledge library can read, an empty upload and a missing file are all
 *   refused with the payload guard, and write nothing.
 *
 * The temp database is pinned before the route is imported; the import below is therefore an `await`.
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-research-upload-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "research.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const { POST } = await import("./route");
const { listResearchMaterials } = await import("@/db/repositories/research");

const uploadUrl = "http://localhost/api/research/upload";

function fileRequest(file: File | null) {
  const form = new FormData();
  if (file) form.append("file", file);
  return new Request(uploadUrl, { method: "POST", body: form });
}

describe("POST /api/research/upload", () => {
  it("imports a text file as a file material whose text is the file's own", async () => {
    const response = await POST(
      fileRequest(new File(["夏季冰饮趋势\n冰饮最好卖的时候是七点以后。"], "summer-notes.txt", { type: "text/plain" })),
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.ok).toBe(true);
    expect(payload.data.item).toMatchObject({
      title: "summer-notes",
      kind: "file",
      fileName: "summer-notes.txt",
      content: "夏季冰饮趋势\n冰饮最好卖的时候是七点以后。",
      status: "ready",
      statusMessage: "",
      sourceUrl: "",
      fetchedAt: null,
    });
  });

  it("imports a supported file with nothing in it as an empty material, not as a silent failure", async () => {
    const response = await POST(fileRequest(new File(["   \n  "], "blank.md", { type: "text/markdown" })));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: { item: { title: "blank", kind: "file", content: "", status: "empty" } },
    });
  });

  it("refuses a file neither this route nor the knowledge library can read, and writes nothing", async () => {
    const before = (await listResearchMaterials()).length;

    const unsupported = await POST(fileRequest(new File(["binary"], "clip.mp4", { type: "video/mp4" })));
    expect(unsupported.status).toBe(400);
    await expect(unsupported.json()).resolves.toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });

    const missing = await POST(fileRequest(null));
    expect(missing.status).toBe(400);

    const emptyFile = await POST(fileRequest(new File([], "nothing.txt", { type: "text/plain" })));
    expect(emptyFile.status).toBe(400);

    expect((await listResearchMaterials()).length).toBe(before);
  });
});
