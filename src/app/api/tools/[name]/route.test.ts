import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * CI-P1-03-02: the tool call entry over HTTP, per `docs/coolpilot-integration-contracts.md` §3.2 layer 5.
 *
 * `src/lib/tools/tool-library.test.ts` pins the pipeline; this file pins the two things only the route
 * decides: the **status code** a `ToolCallError` turns into, and the fact that the body **is** the
 * contract's `ToolCallResult` (`{ ok: true, data }` / `{ ok: false, error: { code, message, retryable } }`)
 * rather than this repository's usual string-envelope error. A caller that only reads the status and a
 * caller that only reads the body must agree - so both are checked for every refusal, plus the two real
 * paths: a read-only tool that succeeds and the image tool that fails with the runtime's own code.
 *
 * The workspace is a throwaway directory pinned before the route (and therefore `@/db/client`) is
 * imported, exactly like `src/app/api/videos/route.test.ts`.
 */

const previousDataDir = process.env.SOCIAL_AUTO_POST_DATA_DIR;
const previousDbUrl = process.env.SOCIAL_AUTO_POST_DB_URL;

let workspace = "";

function pinWorkspace() {
  workspace = mkdtempSync(path.join(tmpdir(), "coolpilot-tools-route-"));
  process.env.SOCIAL_AUTO_POST_DATA_DIR = workspace;
  delete process.env.SOCIAL_AUTO_POST_DB_URL; // the database is derived from the workspace root
}

pinWorkspace();
const { POST } = await import("./route");

beforeAll(() => {
  mkdirSync(path.join(workspace, "artifacts"), { recursive: true });
  writeFileSync(path.join(workspace, "artifacts", "first.png"), "not really a png");
});

afterAll(() => {
  if (previousDataDir === undefined) delete process.env.SOCIAL_AUTO_POST_DATA_DIR;
  else process.env.SOCIAL_AUTO_POST_DATA_DIR = previousDataDir;
  if (previousDbUrl === undefined) delete process.env.SOCIAL_AUTO_POST_DB_URL;
  else process.env.SOCIAL_AUTO_POST_DB_URL = previousDbUrl;
  try {
    rmSync(workspace, { recursive: true, force: true });
  } catch {
    // A throwaway folder the OS reclaims on its own.
  }
});

/** One call as the console sends it; a string body is passed through to pin a malformed request. */
async function callToolRoute(name: string, body?: unknown) {
  const response = await POST(
    new Request(`http://localhost/api/tools/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...(body === undefined
        ? {}
        : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ name }) },
  );
  return { status: response.status, body: await response.json() };
}

describe("POST /api/tools/[name]", () => {
  it("answers a read-only tool with 200 and its own result", async () => {
    const { status, body } = await callToolRoute("media_list_assets", { input: {} });

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.total).toBe(1);
    expect(body.data.assets.map((asset: { fileName: string }) => asset.fileName)).toEqual([
      "first.png",
    ]);
  });

  it("answers an unknown name with 404 and the names that exist", async () => {
    const { status, body } = await callToolRoute("browser_open_page", { input: { url: "x" } });

    expect(status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("UNKNOWN_TOOL");
    expect(body.error.retryable).toBe(false);
    expect(body.error.details.available).toEqual([
      "generate_image_file",
      "media_list_assets",
      "video_render",
    ]);
  });

  it("answers invalid tool input with 400 and machine-readable issues", async () => {
    const { status, body } = await callToolRoute("media_list_assets", { input: { root: "nowhere" } });

    expect(status).toBe(400);
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(body.error.details.issues).toEqual([{ path: "root", code: "invalid_value" }]);
    expect(JSON.stringify(body)).not.toContain("expected string");
  });

  it("answers a malformed request body as a bad request, not as a bad tool input", async () => {
    const notJson = await callToolRoute("media_list_assets", "not json at all");
    const badField = await callToolRoute("media_list_assets", { taskId: 5 });

    expect([notJson.status, badField.status]).toEqual([400, 400]);
    for (const { body } of [notJson, badField]) {
      expect(body.error.code).toBe("INVALID_INPUT");
      expect(body.error.message).toContain("Invalid request body for tool");
    }
  });

  it("answers a host task that does not exist with 400", async () => {
    const { status, body } = await callToolRoute("media_list_assets", {
      input: {},
      taskId: "no-such-task",
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe("TASK_NOT_FOUND");
    expect(body.error.details.role).toBe("host");
  });

  it("answers an unapproved side-effecting tool with 409, and runs it once approved", async () => {
    const unapproved = await callToolRoute("generate_image_file", { input: { prompt: "a red fox" } });
    expect(unapproved.status).toBe(409);
    expect(unapproved.body.error.code).toBe("APPROVAL_REQUIRED");
    expect(unapproved.body.error.details).toEqual({ tool: "generate_image_file" });

    // Approved, the tool really runs - and really fails, because this workspace has no image-capable
    // model. The failure is the answer, with the runtime's own code, not a fake success.
    const approved = await callToolRoute("generate_image_file", {
      input: { prompt: "a red fox" },
      approvals: { grantedToolCallId: "call_1" },
    });
    expect(approved.status).toBe(500);
    expect(approved.body.ok).toBe(false);
    expect(approved.body.error.code).toBe("TOOL_FAILED");
    expect(approved.body.error.details.upstreamCode).toMatch(/^MODEL_/);
    expect(approved.body.error.retryable).toBe(false);
  });
});
