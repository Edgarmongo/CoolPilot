import { createClient } from "@libsql/client";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { credentialVaultFileNames } from "@/lib/credentials";
import { artifactsRoot, browserProfilesRoot, dataRoot, uploadsRoot, videosRoot } from "@/lib/paths";
import { createWorkspaceManifest } from "./manifest";

/**
 * P5-B0-2: the workspace manifest answers "where is my workspace, what is in it, and what is
 * linked to what" without changing anything it looks at.
 *
 * Every invariant below has a cheaper way to be wrong, and each of them is pinned here:
 *
 *   - `@/lib/paths` used to create every root it resolved (`mkdirSync`), so a manifest that asked it
 *     where `artifacts` lives would bring an empty workspace into existence. Both halves are gone
 *     now (P5-B0-2.5): the accessors resolve and the `ensure*` initializers create, and the manifest
 *     reads the root and every section through those same accessors - which is what the tests below
 *     that build files through them keep honest. The two views of the layout cannot drift apart
 *     unnoticed.
 *   - `@libsql/client` creates a missing database file the moment a statement runs on it
 *     (measured, see `manifest.ts`), so a workspace with no database is reported from `existsSync`
 *     and never opened.
 *   - an artifact is linked while *content* references its file name - `contentImageList()`, the
 *     list the editor writes and the publish pipeline reads.
 *   - a browser profile belongs to the account whose id names its directory. The stored
 *     `accounts.profile_path` is history (F9) and must not reach the report at all.
 *   - a table sitting in the database that the drizzle schema does not declare is data the user
 *     has and the code cannot see (P5-B0-1: `accounts` rows inside `sites`), so it is reported
 *     rather than treated as absent.
 *
 * The temporary workspaces are left behind on purpose: a local `@libsql/client` keeps the database
 * file open on Windows, so deleting the folder afterwards fails with `EBUSY`.
 * `src/test/route-harness.ts` and `src/lib/backup.test.ts` leave theirs behind for the same reason.
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

let root = "";

const previousDataDir = process.env.SOCIAL_AUTO_POST_DATA_DIR;
const previousDatabaseUrl = process.env.SOCIAL_AUTO_POST_DB_URL;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "coolpilot-manifest-"));
  process.env.SOCIAL_AUTO_POST_DATA_DIR = root;
  delete process.env.SOCIAL_AUTO_POST_DB_URL;
  delete process.env.COOLPILOT_ELECTRON;
});

afterAll(() => {
  for (const [name, value] of [
    ["SOCIAL_AUTO_POST_DATA_DIR", previousDataDir],
    ["SOCIAL_AUTO_POST_DB_URL", previousDatabaseUrl],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  delete process.env.COOLPILOT_ELECTRON;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function fileUrl(filePath: string) {
  return `file:${filePath.replace(/\\/g, "/")}`;
}

/** Writes a file inside the workspace under test, with its parents, and reports its size. */
async function writeWorkspaceFile(filePath: string, contents: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents);
  return Buffer.byteLength(contents);
}

/** The workspace database, written before the manifest is ever called. */
async function writeDatabase(statements: Statement[], relativeFileName = DATABASE_FILE_NAME) {
  const filePath = path.join(root, relativeFileName);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const connection = createClient({ url: fileUrl(filePath) });
  try {
    for (const statement of statements) {
      await connection.execute(statement);
    }
  } finally {
    connection.close();
  }
  return filePath;
}

/** Every directory and file the workspace root is expected to own. */
function workspaceLayout() {
  return [
    path.join(root, DATABASE_FILE_NAME),
    path.join(root, "artifacts"),
    path.join(root, "browser-profiles"),
    path.join(root, "uploads"),
    path.join(root, "videos"),
  ];
}



describe("workspace manifest", () => {
  it("returns exactly the report the console reads, and nothing else", async () => {
    const manifest = await createWorkspaceManifest();

    expect(Object.keys(manifest).sort()).toEqual([
      "artifacts",
      "browserProfiles",
      "database",
      "generatedAt",
      // The `media/` section CI-P3-02 added: the audio/video a transcription reads.
      "media",
      "root",
      "unaccounted",
      "uploads",
      "videos",
    ]);
    expect(Object.keys(manifest.database).sort()).toEqual([
      "exists",
      "path",
      "sizeBytes",
      "tableCount",
      "unknownTables",
    ]);
    expect(Object.keys(manifest.artifacts).sort()).toEqual(["fileCount", "linked", "totalBytes", "unlinked"]);
    expect(Object.keys(manifest.browserProfiles).sort()).toEqual([
      "linked",
      "total",
      "unlinked",
      "unlinkedProfiles",
    ]);
    expect(Object.keys(manifest.videos).sort()).toEqual(["exists", "fileCount", "totalBytes"]);
    expect(Object.keys(manifest.media).sort()).toEqual(["exists", "fileCount", "totalBytes"]);
    expect(Object.keys(manifest.uploads).sort()).toEqual([
      "brandLogos",
      "exists",
      "fileCount",
      "productImages",
      "totalBytes",
    ]);
    expect(Object.keys(manifest.uploads.productImages).sort()).toEqual(["exists", "fileCount", "totalBytes"]);
    expect(Object.keys(manifest.uploads.brandLogos).sort()).toEqual(["exists", "fileCount", "totalBytes"]);
    expect(Object.keys(manifest.unaccounted).sort()).toEqual(["rootFiles"]);
    expect(typeof manifest.generatedAt).toBe("number");
  });

  it("reports the open workspace, its database and the tables the schema does not declare", async () => {
    const databasePath = await writeDatabase([
      { sql: ACCOUNTS_DDL },
      { sql: CONTENT_ITEMS_DDL },
      { sql: "CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')" },
      // P5-B0-1: `sites` held accounts this build could not see. A schema that does not know a
      // table is not evidence that the table is not there.
      { sql: "CREATE TABLE sites (id TEXT PRIMARY KEY)" },
      { sql: "CREATE TABLE ai_providers (id TEXT PRIMARY KEY)" },
      { sql: "INSERT INTO accounts (id, name) VALUES ('acc-1', 'Meow')" },
    ]);

    const manifest = await createWorkspaceManifest();

    expect(manifest.root).toBe(dataRoot());
    expect(manifest.root.startsWith(root)).toBe(true);
    expect(manifest.database).toEqual({
      path: databasePath,
      exists: true,
      sizeBytes: statSync(databasePath).size,
      tableCount: 5,
      unknownTables: ["ai_providers", "sites"],
    });
  });

  it("keeps reading a workspace whose database file is missing", async () => {
    const manifest = await createWorkspaceManifest();

    expect(manifest.database).toEqual({
      path: path.join(root, DATABASE_FILE_NAME),
      exists: false,
      sizeBytes: 0,
      tableCount: 0,
      unknownTables: [],
    });
  });

  it("splits the artifacts into the files content references and the ones nothing does", async () => {
    const artifacts = artifactsRoot();
    const first = await writeWorkspaceFile(path.join(artifacts, "a.png"), "xx");
    const second = await writeWorkspaceFile(path.join(artifacts, "b.jpg"), "xxx");
    const orphan = await writeWorkspaceFile(path.join(artifacts, "orphan.png"), "xxxx");
    // A nested file is not an artifact content can point at: `/api/agent/artifacts?file=` takes a
    // file name, and a request that carries a path is answered with 404. It is still data on disk,
    // so it counts towards the sizes and not towards the split.
    const nested = await writeWorkspaceFile(path.join(artifacts, "publish-logs", "shot.png"), "xxxxx");

    await writeDatabase([
      { sql: ACCOUNTS_DDL },
      { sql: CONTENT_ITEMS_DDL },
      {
        sql: "INSERT INTO content_items (id, image_path, metadata_json) VALUES ('c1', '', ?)",
        args: [JSON.stringify({ images: ["a.png", "ghost.png"] })],
      },
      // A draft older than the stored list: the cover column is all it has.
      { sql: "INSERT INTO content_items (id, image_path, metadata_json) VALUES ('c2', 'b.jpg', '{}')" },
    ]);

    const manifest = await createWorkspaceManifest();

    expect(manifest.artifacts).toEqual({
      fileCount: 4,
      totalBytes: first + second + orphan + nested,
      // `ghost.png` is referenced by content and not on disk, so it links no file: linked and
      // unlinked partition the artifacts, they do not count references.
      linked: 2,
      unlinked: 1,
    });
  });

  it("counts a browser profile as linked while the account it is named after exists", async () => {
    const profiles = browserProfilesRoot();
    await writeWorkspaceFile(path.join(profiles, "acc-1", "Default", "Cookies"), "xxx");
    await writeWorkspaceFile(path.join(profiles, "acc-1", "Default", "Local State"), "xxxx");
    const stale = await writeWorkspaceFile(path.join(profiles, "stale-profile-id", "Default", "Cookies"), "xxxxx");

    await writeDatabase([
      { sql: ACCOUNTS_DDL },
      // F9: the stored path is history. The profile is the account's directory in *this* workspace.
      {
        sql: "INSERT INTO accounts (id, name, profile_path) VALUES ('acc-1', 'Meow', 'C:/profiles/elsewhere/acc-1')",
      },
      // An account that has never been opened has no profile directory, and is not an orphan.
      {
        sql: "INSERT INTO accounts (id, name, profile_path) VALUES ('acc-2', 'Woof', 'C:/profiles/elsewhere/acc-2')",
      },
    ]);

    const manifest = await createWorkspaceManifest();

    expect(manifest.browserProfiles).toEqual({
      total: 2,
      linked: 1,
      unlinked: 1,
      // Only the orphans are measured: the linked ones are the accounts the console already lists.
      unlinkedProfiles: [{ id: "stale-profile-id", fileCount: 1, sizeBytes: stale }],
    });
  });

  it("never reports the profile path stored on the account", async () => {
    const profiles = browserProfilesRoot();
    // F9: `accounts.profile_path` is history. The report names the account the profile belongs to
    // (`acc-1`, a directory that is linked) and the profiles nobody claims (`leftover-9d2f`), and
    // the stored location is never part of either.
    await writeWorkspaceFile(path.join(profiles, "acc-1", "Cookies"), "x");
    await writeWorkspaceFile(path.join(profiles, "leftover-9d2f", "Cookies"), "x");
    await writeDatabase([
      { sql: ACCOUNTS_DDL },
      {
        sql: "INSERT INTO accounts (id, name, profile_path) VALUES ('acc-1', 'Meow', 'D:/legacy-location/leftover-9d2f')",
      },
    ]);

    const manifest = await createWorkspaceManifest();
    const report = JSON.stringify(manifest);

    expect(manifest.browserProfiles.linked).toBe(1);
    expect(manifest.browserProfiles.unlinkedProfiles.map((profile) => profile.id)).toEqual(["leftover-9d2f"]);
    expect(report).not.toContain("legacy-location");
    expect(report).not.toContain("profilePath");
    expect(report).not.toContain("profile_path");
  });

  it("counts videos and the uploads of both image kinds", async () => {
    const video = await writeWorkspaceFile(path.join(videosRoot(), "clip.mp4"), "xxxxxx");
    const productImage = await writeWorkspaceFile(path.join(uploadsRoot(), "product-images", "p1.png"), "xx");
    const brandLogo = await writeWorkspaceFile(path.join(uploadsRoot(), "brand-logos", "l1.png"), "xxx");
    // A file loose in `uploads` belongs to the `uploads` total and to neither breakdown.
    const stray = await writeWorkspaceFile(path.join(uploadsRoot(), "loose.txt"), "x");

    const manifest = await createWorkspaceManifest();

    expect(manifest.videos).toEqual({ exists: true, fileCount: 1, totalBytes: video });
    expect(manifest.uploads).toEqual({
      exists: true,
      fileCount: 3,
      totalBytes: productImage + brandLogo + stray,
      productImages: { exists: true, fileCount: 1, totalBytes: productImage },
      brandLogos: { exists: true, fileCount: 1, totalBytes: brandLogo },
    });
  });

  it("reports an empty workspace without creating any of it", async () => {
    const manifest = await createWorkspaceManifest();

    expect(manifest.artifacts).toEqual({ fileCount: 0, totalBytes: 0, linked: 0, unlinked: 0 });
    expect(manifest.browserProfiles).toEqual({ total: 0, linked: 0, unlinked: 0, unlinkedProfiles: [] });
    expect(manifest.videos).toEqual({ exists: false, fileCount: 0, totalBytes: 0 });
    expect(manifest.uploads).toEqual({
      exists: false,
      fileCount: 0,
      totalBytes: 0,
      productImages: { exists: false, fileCount: 0, totalBytes: 0 },
      brandLogos: { exists: false, fileCount: 0, totalBytes: 0 },
    });
    // Not one of the roots `@/lib/paths` would have made on the way to these numbers.
    expect(workspaceLayout().filter((entry) => existsSync(entry))).toEqual([]);
  });

  it("does not create a workspace that is not there yet", async () => {
    const missing = path.join(root, "not-created-yet");
    process.env.SOCIAL_AUTO_POST_DATA_DIR = missing;

    const manifest = await createWorkspaceManifest();

    expect(manifest.root).toBe(missing);
    expect(manifest.database.exists).toBe(false);
    expect(manifest.browserProfiles.total).toBe(0);
    expect(existsSync(missing)).toBe(false);
  });

  it("reads a workspace directory that exists but is empty", async () => {
    for (const directory of ["artifacts", "browser-profiles", "uploads", "videos"]) {
      await fs.mkdir(path.join(root, directory), { recursive: true });
    }

    const manifest = await createWorkspaceManifest();

    expect(manifest.artifacts.fileCount).toBe(0);
    expect(manifest.browserProfiles.total).toBe(0);
    expect(manifest.videos).toEqual({ exists: true, fileCount: 0, totalBytes: 0 });
    expect(manifest.uploads.exists).toBe(true);
    expect(manifest.uploads.productImages.exists).toBe(false);
  });

  it("lists the root files the workspace does not account for", async () => {
    await writeWorkspaceFile(path.join(root, DATABASE_FILE_NAME), "");
    await writeWorkspaceFile(path.join(root, `${DATABASE_FILE_NAME}-wal`), "x");
    await writeWorkspaceFile(path.join(root, credentialVaultFileNames[0]), "x");
    await writeWorkspaceFile(path.join(root, credentialVaultFileNames[1]), "x");
    // The file this whole section was written for: a database nothing in the tree references.
    await writeWorkspaceFile(path.join(root, "_tmp-e2e.db"), "");
    const notes = await writeWorkspaceFile(path.join(root, "notes.txt"), "xxxx");
    // A file inside a workspace section belongs to that section's inventory: `rootFiles` is the
    // root level, so a stray directory is only visible through what it holds.
    await writeWorkspaceFile(path.join(root, "unknown-dir", "inside.txt"), "xxxxx");

    const manifest = await createWorkspaceManifest();

    expect(manifest.unaccounted.rootFiles).toEqual([
      { name: "_tmp-e2e.db", sizeBytes: 0 },
      { name: "notes.txt", sizeBytes: notes },
    ]);
  });

  it("does not change the workspace while it reads it", async () => {
    const databasePath = await writeDatabase([
      { sql: ACCOUNTS_DDL },
      { sql: "INSERT INTO accounts (id, name) VALUES ('acc-1', 'Meow')" },
    ]);
    const artifacts = artifactsRoot();
    const artifactPath = path.join(artifacts, "a.png");
    await writeWorkspaceFile(artifactPath, "x");
    const before = {
      database: statSync(databasePath),
      artifact: statSync(artifactPath),
      artifacts: statSync(artifacts),
    };
    // Long enough that a write would land in a later timestamp rather than in the same tick.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const manifest = await createWorkspaceManifest();

    expect(manifest.database.exists).toBe(true);
    expect(manifest.artifacts.fileCount).toBe(1);
    expect(statSync(databasePath).mtimeMs).toBe(before.database.mtimeMs);
    expect(statSync(databasePath).size).toBe(before.database.size);
    expect(statSync(artifactPath).mtimeMs).toBe(before.artifact.mtimeMs);
    expect(statSync(artifacts).mtimeMs).toBe(before.artifacts.mtimeMs);
  });

  it("reads a database file that is empty", async () => {
    // The shape `_tmp-e2e.db` has in the real workspace: a SQLite file with nothing in it.
    await writeWorkspaceFile(path.join(root, DATABASE_FILE_NAME), "");

    const manifest = await createWorkspaceManifest();

    expect(manifest.database).toEqual({
      path: path.join(root, DATABASE_FILE_NAME),
      exists: true,
      sizeBytes: 0,
      tableCount: 0,
      unknownTables: [],
    });
  });

  it("keeps reading a workspace whose database file is not a database", async () => {
    // A file that carries the database name without being one. The inventory reports what it can
    // read, says out loud what it could not, and does not turn the rest of the workspace into an
    // error the caller has to handle.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const databasePath = path.join(root, DATABASE_FILE_NAME);
    const sizeBytes = await writeWorkspaceFile(databasePath, "x");

    const manifest = await createWorkspaceManifest();

    expect(manifest.database).toEqual({
      path: databasePath,
      exists: true,
      sizeBytes,
      tableCount: 0,
      unknownTables: [],
    });
    expect(manifest.browserProfiles).toEqual({ total: 0, linked: 0, unlinked: 0, unlinkedProfiles: [] });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("social-auto-post.db");
  });

  it("reports a configured database that is not there without creating it", async () => {
    const configured = path.join(root, "elsewhere", "other.db");
    process.env.SOCIAL_AUTO_POST_DB_URL = fileUrl(configured);

    const manifest = await createWorkspaceManifest();

    expect(manifest.database).toEqual({
      path: configured,
      exists: false,
      sizeBytes: 0,
      tableCount: 0,
      unknownTables: [],
    });
    expect(existsSync(configured)).toBe(false);
  });

  it("reads the configured database where it is and does not call it unaccounted", async () => {
    process.env.SOCIAL_AUTO_POST_DB_URL = fileUrl(path.join(root, "other.db"));
    const databasePath = await writeDatabase([{ sql: ACCOUNTS_DDL }], "other.db");

    const manifest = await createWorkspaceManifest();

    expect(manifest.database).toMatchObject({ path: databasePath, exists: true, tableCount: 1 });
    expect(manifest.unaccounted.rootFiles).toEqual([]);
  });

  it("reports a database URL that is not a local file without reaching for it", async () => {
    process.env.SOCIAL_AUTO_POST_DB_URL = "libsql://workspace.example.turso.io";

    const manifest = await createWorkspaceManifest();

    expect(manifest.database).toEqual({
      path: "libsql://workspace.example.turso.io",
      exists: false,
      sizeBytes: 0,
      tableCount: 0,
      unknownTables: [],
    });
    expect(manifest.browserProfiles.unlinkedProfiles).toEqual([]);
  });

  it("resolves a relative database URL the way the packaged app does", async () => {
    process.env.COOLPILOT_ELECTRON = "1";
    process.env.SOCIAL_AUTO_POST_DB_URL = "file:relative.db";

    const manifest = await createWorkspaceManifest();

    // `@/db/client` sends a relative `file:` URL loaded from a standalone bundle back to the open
    // workspace; an inventory that read a different database than the app writes would be worse
    // than no inventory.
    expect(manifest.database.path).toBe(path.join(root, DATABASE_FILE_NAME));
  });
});
