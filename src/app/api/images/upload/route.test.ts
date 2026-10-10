import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * F3 of `docs/p1-card-01-defect-f1-f3-plan.md`: `POST /api/images/upload` is the route that puts
 * every editor upload into the artifacts section, and it had no test file at all. The artifacts
 * route next to it has its own cases (`src/app/api/agent/artifacts/route.test.ts`), one of which
 * this file's GIF case completes: the write side and the read side of the same stored name.
 *
 * What is pinned here, and why each piece is separate:
 *
 *  1. the response's `fileName` and the **literal** URL shape - the shape is what `article-editor`
 *     persists into `content_items.body`, so it has to fail loudly if it drifts;
 *  2. the same URL equals `artifactImageUrl(fileName)`, which is what keeps this route wired to the
 *     shared helper instead of growing a copy of its own (the drift the literal alone cannot see);
 *  3. the bytes really land in the artifacts section **of the temp data root** - asserted, not
 *     assumed, so a run can never touch `web-data/`;
 *  4. the rejection paths survive the next refactor - `INVALID_PAYLOAD` as a code, the other two as
 *     the token `fail()` writes into `error` (see `refusal()` below).
 *
 * The harness pins the temp database and the temp data root before anything that reads them loads
 * (`src/test/route-harness.ts`), so it has to be the first `await` here.
 */

const { routeTestDataDir } = await import("@/test/route-harness");
const { POST } = await import("./route");
const { GET } = await import("@/app/api/agent/artifacts/route");
const { artifactImageUrl } = await import("@/lib/artifact-image-url");

const uploadUrl = "http://localhost/api/images/upload";

/** The artifacts directory of the *temp* data root, the only directory these cases touch. */
const artifactsDir = path.join(routeTestDataDir, "artifacts");
/** The developer's workspace, which a run of this file must never write into. */
const devWorkspace = path.join(process.cwd(), "web-data");

/** Recognisable bytes, the convention `src/app/api/images/route.test.ts` already uses. */
const pngBytes = "png-bytes";
const gifBytes = "gif-bytes";

function uploadFile(file: File) {
  const form = new FormData();
  form.append("file", file);
  return POST(new Request(uploadUrl, { method: "POST", body: form }));
}

const upload = (name: string, type: string, bytes = pngBytes) =>
  uploadFile(new File([bytes], name, { type }));

const serve = (fileName: string) =>
  GET(new Request(`http://localhost/api/agent/artifacts?file=${encodeURIComponent(fileName)}`));

/** The files in the temp artifacts section, sorted - a case can compare the whole directory. */
async function storedFiles() {
  await fs.mkdir(artifactsDir, { recursive: true });
  return (await fs.readdir(artifactsDir)).sort();
}

/**
 * The refusal shape. `INVALID_PAYLOAD` is a real code in `appErrorCodes`, while `UNSUPPORTED_IMAGE`
 * and `EMPTY_UPLOAD` are not: `fail()` turns those two into `code: "UNKNOWN_ERROR"` with the token
 * as the message, so the token is what this file pins. The `code` value itself is recorded in the
 * D1 acceptance record rather than asserted - adding the two tokens to `appErrorCodes` would be a
 * real improvement, and it should not have to rewrite this file to happen.
 */
async function refusal(response: Response, token: string) {
  expect(response.status).toBe(400);
  const body = await response.json();
  expect(body.ok).toBe(false);
  expect(body.error).toBe(token);
  expect(body.message).toBe(token);
}

describe("POST /api/images/upload", () => {
  afterEach(async () => {
    for (const name of await storedFiles()) {
      await fs.rm(path.join(artifactsDir, name), { force: true });
    }
  });

  it("answers the stored URL shape for an uploaded image", async () => {
    const response = await upload("shot.png", "image/png");

    expect(response.status).toBe(201);
    const { ok, data } = await response.json();
    expect(ok).toBe(true);
    expect(data.fileName).toMatch(/^upload-\d+-[A-Za-z0-9_-]{8}\.png$/);

    // The literal pins the shape; the equality pins the wiring. Neither one alone can see both.
    expect(data.url).toBe(`/api/agent/artifacts?file=${encodeURIComponent(data.fileName)}`);
    expect(data.url).toBe(artifactImageUrl(data.fileName));
  });

  it("writes the uploaded bytes into the artifacts section of the temp root", async () => {
    const response = await upload("shot.png", "image/png");
    const { data } = await response.json();
    const storedPath = path.join(artifactsDir, data.fileName);

    // Asserted, not assumed: the temp root is what makes this file safe to run.
    expect(storedPath).toBe(path.join(routeTestDataDir, "artifacts", data.fileName));
    expect(storedPath.startsWith(devWorkspace)).toBe(false);
    expect(await fs.readFile(storedPath, "utf-8")).toBe(pngBytes);
  });

  it("serves an uploaded GIF back with the GIF content type", async () => {
    // F1: the write side has always accepted `.gif`; this case walks the same stored name through
    // the read side, which is where the extension was missing from the content-type map.
    const response = await upload("anim.gif", "image/gif", gifBytes);

    expect(response.status).toBe(201);
    const { data } = await response.json();
    expect(data.fileName.endsWith(".gif")).toBe(true);

    const served = await serve(data.fileName);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/gif");
    expect(await served.text()).toBe(gifBytes);
  });

  it("keeps the rejection paths of an unsupported or empty upload", async () => {
    await refusal(await upload("notes.txt", "text/plain"), "UNSUPPORTED_IMAGE");
    await refusal(await uploadFile(new File([], "empty.png", { type: "image/png" })), "EMPTY_UPLOAD");
  });

  it("answers a body that carries no file", async () => {
    // A field that is not a file is refused by the same branch an empty form would hit.
    const form = new FormData();
    form.append("other", "not-a-file");
    await refusal(await POST(new Request(uploadUrl, { method: "POST", body: form })), "EMPTY_UPLOAD");

    // A body that is not a form at all is caught before the field lookup, and it is the one refusal
    // that answers with a real code.
    const notAForm = await POST(
      new Request(uploadUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(notAForm.status).toBe(400);
    const body = await notAForm.json();
    expect(body.code).toBe("INVALID_PAYLOAD");
    expect(body.error).toBe("Invalid payload");
  });

  it("defaults an upload without an extension to .png", async () => {
    const response = await upload("shot", "image/png");

    expect(response.status).toBe(201);
    expect((await response.json()).data.fileName.endsWith(".png")).toBe(true);
  });
});
