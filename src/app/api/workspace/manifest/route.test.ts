import { createClient } from "@libsql/client";
import fs from "node:fs";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P5-B0-3-A: the workspace manifest over HTTP.
 *
 * The report itself is argued and pinned in `@/lib/workspace/manifest.test.ts`. This file is about
 * what the route adds to it, which is supposed to be nothing, and about the four ways an HTTP
 * boundary can still get it wrong:
 *
 *   - the answer arrives in the envelope the console already reads (`{ ok, data }`) and `data` is
 *     the manifest, not a summary of it;
 *   - every degradation the manifest was written to absorb - a workspace that does not exist, a
 *     database file that is not a database - is a `200`. A `404` or a `500` here would be a second
 *     policy for facts the manifest already decided, and it would be the route, not the report,
 *     that the console had to understand;
 *   - a `GET` does not create the workspace it reports on: the read-only promise of P5-B0-2.5,
 *     now reachable over HTTP, checked against a snapshot of every name, size and mtime;
 *   - a manifest that throws is the standard error shape, never a partial report that reads like a
 *     workspace which lost its files (the impression P5-B0-1 was about).
 */

const DATABASE_FILE_NAME = "social-auto-post.db";

const ACCOUNTS_DDL = `CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  profile_path TEXT NOT NULL DEFAULT ''
)`;

const CONTENT_ITEMS_DDL = `CREATE TABLE content_items (
  id TEXT PRIMARY KEY,
  image_path TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}'
)`;

type Statement = { sql: string; args?: Array<string | number> };

const previousDataDir = process.env.SOCIAL_AUTO_POST_DATA_DIR;
const previousDatabaseUrl = process.env.SOCIAL_AUTO_POST_DB_URL;

let root = "";

/**
 * A workspace of this test's own, with `SOCIAL_AUTO_POST_DB_URL` unset so the database is the one
 * the report derives from the root. Pinned before the route is imported: the layout is read from
 * the environment, and a module body runs after its imports.
 */
function pinWorkspace() {
  root = mkdtempSync(path.join(tmpdir(), "coolpilot-workspace-route-"));
  process.env.SOCIAL_AUTO_POST_DATA_DIR = root;
  delete process.env.SOCIAL_AUTO_POST_DB_URL;
  delete process.env.COOLPILOT_ELECTRON;
}

pinWorkspace();
const { GET } = await import("./route");

/** What the console sees: the status and the parsed body of `GET /api/workspace/manifest`. */
async function manifest() {
  const response = await GET();
  return { status: response.status, body: await response.json() };
}

/** Writes a file inside the workspace, with its parents, and reports how many bytes it holds. */
async function writeWorkspaceFile(filePath: string, contents: string) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, contents);
  return Buffer.byteLength(contents);
}

/** The workspace database, written before the route is ever called. */
async function writeDatabase(statements: Statement[]) {
  const filePath = path.join(root, DATABASE_FILE_NAME);
  const connection = createClient({ url: `file:${filePath.replace(/\\/g, "/")}` });
  try {
    for (const statement of statements) await connection.execute(statement);
  } finally {
    connection.close();
  }
  return filePath;
}

/**
 * Every entry of the workspace root, with the size and mtime a write would move. A list of names
 * alone would miss a rewrite, and the mtime is what a section created behind a reader's back gives
 * away.
 */
function snapshot(directory: string, prefix = ""): string[] {
  const entries = fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  const lines: string[] = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const stats = statSync(path.join(directory, entry.name));
    lines.push(`${relative} ${entry.isDirectory() ? "dir" : "file"} ${stats.size} ${stats.mtimeMs}`);
    if (entry.isDirectory()) lines.push(...snapshot(path.join(directory, entry.name), relative));
  }
  return lines;
}

describe("GET /api/workspace/manifest", () => {
  beforeEach(() => {
    pinWorkspace();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    // The temporary workspaces are left behind on purpose: a local `@libsql/client` keeps the
    // database file open on Windows, so deleting the folder afterwards fails with `EBUSY`.
    // `src/test/route-harness.ts` and `manifest.test.ts` leave theirs behind for the same reason.
    for (const [name, value] of [
      ["SOCIAL_AUTO_POST_DATA_DIR", previousDataDir],
      ["SOCIAL_AUTO_POST_DB_URL", previousDatabaseUrl],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    delete process.env.COOLPILOT_ELECTRON;
  });

  it("answers the report of the open workspace in the envelope the console reads", async () => {
    const cover = await writeWorkspaceFile(path.join(root, "artifacts", "cover.png"), "png-bytes");
    const loose = await writeWorkspaceFile(path.join(root, "artifacts", "nothing-uses-me.png"), "xx");
    const video = await writeWorkspaceFile(path.join(root, "videos", "clip.mp4"), "xxxxxx");
    const productImage = await writeWorkspaceFile(
      path.join(root, "uploads", "product-images", "p1.png"),
      "xx",
    );
    // A profile nobody claims: no account in the database carries this id (F9).
    const orphan = await writeWorkspaceFile(
      path.join(root, "browser-profiles", "leftover-9d2f", "Cookies"),
      "xxx",
    );
    const notes = await writeWorkspaceFile(path.join(root, "notes.txt"), "xxxx");
    const databasePath = await writeDatabase([
      { sql: ACCOUNTS_DDL },
      { sql: CONTENT_ITEMS_DDL },
      // P5-B0-1: a table this build's schema does not declare still holds data the user has.
      { sql: "CREATE TABLE sites (id TEXT PRIMARY KEY)" },
      { sql: "INSERT INTO accounts (id, name) VALUES ('acc-1', 'Meow')" },
      {
        sql: "INSERT INTO content_items (id, image_path, metadata_json) VALUES ('c1', '', ?)",
        args: [JSON.stringify({ images: ["cover.png"] })],
      },
    ]);

    const { status, body } = await manifest();

    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(["data", "ok"]);
    expect(body.ok).toBe(true);
    expect(body.data.root).toBe(root);
    expect(body.data.database).toEqual({
      path: databasePath,
      exists: true,
      sizeBytes: statSync(databasePath).size,
      tableCount: 3,
      unknownTables: ["sites"],
    });
    expect(body.data.artifacts).toEqual({
      fileCount: 2,
      totalBytes: cover + loose,
      linked: 1,
      unlinked: 1,
    });
    expect(body.data.browserProfiles).toEqual({
      total: 1,
      linked: 0,
      unlinked: 1,
      unlinkedProfiles: [{ id: "leftover-9d2f", fileCount: 1, sizeBytes: orphan }],
    });
    expect(body.data.videos).toEqual({ exists: true, fileCount: 1, totalBytes: video });
    expect(body.data.uploads).toEqual({
      exists: true,
      fileCount: 1,
      totalBytes: productImage,
      productImages: { exists: true, fileCount: 1, totalBytes: productImage },
      brandLogos: { exists: false, fileCount: 0, totalBytes: 0 },
    });
    // The sections are complete, so the root file nothing owns is still named.
    expect(body.data.unaccounted.rootFiles).toEqual([{ name: "notes.txt", sizeBytes: notes }]);
    expect(typeof body.data.generatedAt).toBe("number");
  });

  it("answers a workspace that does not exist yet instead of creating it", async () => {
    rmSync(root, { recursive: true, force: true });

    const { status, body } = await manifest();

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.root).toBe(root);
    expect(body.data.database).toEqual({
      path: path.join(root, DATABASE_FILE_NAME),
      exists: false,
      sizeBytes: 0,
      tableCount: 0,
      unknownTables: [],
    });
    expect(body.data.artifacts).toEqual({ fileCount: 0, totalBytes: 0, linked: 0, unlinked: 0 });
    expect(body.data.videos).toEqual({ exists: false, fileCount: 0, totalBytes: 0 });
    expect(body.data.uploads.exists).toBe(false);
    expect(body.data.unaccounted.rootFiles).toEqual([]);
    // Not one of the roots `@/lib/paths` would have made on the way to these numbers, and not the
    // database file either: the report describes a workspace instead of bringing it into being.
    expect(fs.existsSync(root)).toBe(false);
  });

  it("keeps the report when the database file is not a database", async () => {
    // `SQLITE_NOTADB` on a file that carries the database name - the shape P5-B0-2 measured. The
    // manifest reports what it could read and says out loud what it could not; over HTTP that is a
    // `200` with a smaller table count, not an error the console has to know about.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const artifact = await writeWorkspaceFile(path.join(root, "artifacts", "cover.png"), "png-bytes");
    const stray = "not-a-database";
    const databasePath = path.join(root, DATABASE_FILE_NAME);
    await writeWorkspaceFile(databasePath, stray);

    const { status, body } = await manifest();

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.database).toEqual({
      path: databasePath,
      exists: true,
      sizeBytes: Buffer.byteLength(stray),
      tableCount: 0,
      unknownTables: [],
    });
    expect(body.data.artifacts).toEqual({ fileCount: 1, totalBytes: artifact, linked: 0, unlinked: 1 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(DATABASE_FILE_NAME);
  });

  it("reads the workspace without changing it", async () => {
    await writeWorkspaceFile(path.join(root, "artifacts", "cover.png"), "png-bytes");
    await writeWorkspaceFile(path.join(root, "browser-profiles", "leftover-9d2f", "Cookies"), "xxx");
    await writeDatabase([
      { sql: ACCOUNTS_DDL },
      { sql: "INSERT INTO accounts (id, name) VALUES ('acc-1', 'Meow')" },
    ]);
    const before = snapshot(root);
    // Long enough that a write would land in a later timestamp rather than in the same tick.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const { status, body } = await manifest();

    expect(status).toBe(200);
    expect(body.data.artifacts.fileCount).toBe(1);
    expect(body.data.browserProfiles.unlinked).toBe(1);
    expect(snapshot(root)).toEqual(before);
    // The sections nothing wrote to are still missing afterwards: a `GET` resolves paths, it does
    // not initialize them.
    expect(fs.existsSync(path.join(root, "videos"))).toBe(false);
    expect(fs.existsSync(path.join(root, "uploads"))).toBe(false);
  });

  it("turns a broken manifest into the standard error shape, not a partial report", async () => {
    // The manifest is written to be total, so the error path is only reachable by breaking it on
    // purpose - here, in the module this route delegates to. Kept last in the file: the mock is
    // registered for the imports that follow it.
    vi.resetModules();
    vi.doMock("@/lib/workspace/manifest", async () => {
      const actual =
        await vi.importActual<typeof import("@/lib/workspace/manifest")>("@/lib/workspace/manifest");
      return {
        ...actual,
        createWorkspaceManifest: async () => {
          throw new Error("inventory blew up");
        },
      };
    });
    const { GET: brokenManifest } = await import("./route");

    const response = await brokenManifest();

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "inventory blew up",
      code: "UNKNOWN_ERROR",
      message: "inventory blew up",
    });

    vi.doUnmock("@/lib/workspace/manifest");
    vi.resetModules();
  });
});
