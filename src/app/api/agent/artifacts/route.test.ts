import fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * P5-B0-2.5: this route used to resolve the workspace itself - `cwd/web-data/artifacts`, with a
 * `SOCIAL_AUTO_POST_DATA_DIR` override bolted on - so it served artifacts in a dev checkout and
 * answered 404 in the packaged app, where the workspace is `APP_DATA_DIR/<folder>`. It now asks
 * `@/lib/paths`, which is also what makes the section readable without being created: the accessor
 * resolves, and nothing here initializes a directory.
 */

const previousAppDataDir = process.env.APP_DATA_DIR;
const previousDataDir = process.env.SOCIAL_AUTO_POST_DATA_DIR;

let parent = "";
let workspace = "";

/** The layout of a packaged app: `APP_DATA_DIR` plus the branded folder, never `cwd/web-data`. */
function pinPackagedWorkspace() {
  parent = mkdtempSync(path.join(tmpdir(), "coolpilot-artifact-route-"));
  workspace = path.join(parent, "CoolPilot");
  process.env.APP_DATA_DIR = parent;
  delete process.env.SOCIAL_AUTO_POST_DATA_DIR;
}

pinPackagedWorkspace();
const { GET } = await import("./route");

function request(file: string) {
  return GET(new Request(`http://localhost/api/agent/artifacts?file=${encodeURIComponent(file)}`));
}

describe("GET /api/agent/artifacts", () => {
  beforeEach(pinPackagedWorkspace);

  afterEach(() => {
    rmSync(parent, { recursive: true, force: true });
  });

  afterAll(() => {
    for (const [name, value] of [
      ["APP_DATA_DIR", previousAppDataDir],
      ["SOCIAL_AUTO_POST_DATA_DIR", previousDataDir],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("serves a file from the artifacts section of the open workspace", async () => {
    fs.mkdirSync(path.join(workspace, "artifacts"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "artifacts", "shot.png"), "png-bytes");

    const response = await request("shot.png");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(await response.text()).toBe("png-bytes");
  });

  it("answers a missing file without initializing the workspace", async () => {
    expect((await request("missing.png")).status).toBe(404);

    expect(fs.existsSync(workspace)).toBe(false);
  });

  it("serves only a file that sits directly in the section", async () => {
    fs.mkdirSync(path.join(workspace, "artifacts", "publish-logs"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "artifacts", "publish-logs", "shot.png"), "png-bytes");

    expect((await request("publish-logs/shot.png")).status).toBe(404);
    expect((await request("../credential-vault.json")).status).toBe(404);
    expect((await request("")).status).toBe(404);
    expect((await request("notes.txt")).status).toBe(404);
  });
});
