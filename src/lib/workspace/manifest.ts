import { createClient } from "@libsql/client";
import { getTableName, isTable } from "drizzle-orm";
import { existsSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import * as schema from "@/db/schema";
import { contentImageList } from "@/lib/content-images";
import { credentialVaultFileNames } from "@/lib/credentials";
import {
  artifactsRoot,
  brandLogosRoot,
  browserProfilesRoot,
  dataRoot,
  normalizeFileUrl,
  productImagesRoot,
  uploadsRoot,
  videosRoot,
} from "@/lib/paths";

/**
 * P5-B0-2: the first real domain API of a workspace, and the only one that reports on the whole
 * of it. It answers "where is my workspace, what is in it, and what does nothing point at yet".
 *
 * The rules it has to keep, and why they are not free:
 *
 *   - **Read-only.** The layout comes from `@/lib/paths`, whose accessors now resolve a path
 *     without creating it (P5-B0-2.5), so this inventory and the boundary cannot describe two
 *     different workspaces. A missing directory is reported as missing and is never created to be
 *     measured: only the `ensure*` accessors, called by a writer, initialize a section.
 *   - **Nothing is written to the database either.** `@libsql/client` creates a missing database
 *     file as soon as a statement runs on it (measured: a `SELECT` on a `file:` URL that does not
 *     exist leaves a 4 KiB file behind), so a database that is not there is reported from
 *     `existsSync` and never opened. The connection is opened directly rather than through
 *     `@/db/client`, which runs pending migrations at import time.
 *   - **Linked means content references it.** `contentImageList()` is the only reference list
 *     this manifest uses: the artifact list content writes and the publish pipeline reads. Agent
 *     chat, tool calls and runtime state are not part of the count, because "an agent mentioned a
 *     file name" is not a reference this workspace can answer for yet. A workspace inventory that
 *     guesses would report a number no one can act on.
 *   - **Accounts are the profile owners.** `accounts.profile_path` is history (F9: written once,
 *     stale after a rename), so the identity of a browser profile is the account id it is named
 *     after. The stored path is deliberately not part of any field below.
 *   - **Data the code cannot read is still data.** Tables in the database the drizzle schema does
 *     not declare are listed as `unknownTables` (P5-B0-1: `accounts` rows living inside `sites`),
 *     and files in the workspace root that none of the sections own are listed as
 *     `unaccounted.rootFiles`. Absence of a reader is not absence of data.
 */

export type WorkspaceManifest = {
  /** Absolute path of the workspace in use: what `SOCIAL_AUTO_POST_DATA_DIR` resolves to. */
  root: string;

  database: {
    /**
     * The configured target: a file path, or the URL as configured when the workspace database is
     * not a local file. Nothing else is known about a remote target, so it is not probed.
     */
    path: string;
    exists: boolean;
    sizeBytes: number;
    /** Tables actually in the file. SQLite's own `sqlite_%` tables are not user data. */
    tableCount: number;
    /** Tables the drizzle schema does not declare: data this build cannot read. */
    unknownTables: string[];
  };

  artifacts: {
    /**
     * Everything under `artifacts/`, and among the files directly inside it the ones content
     * references. A file in a nested directory cannot be named by content (the serving route
     * takes a file name and answers 404 for a path), so `linked + unlinked <= fileCount`.
     */
    fileCount: number;
    totalBytes: number;
    linked: number;
    unlinked: number;
  };

  browserProfiles: {
    total: number;
    linked: number;
    unlinked: number;
    /**
     * Only the profiles no account claims, measured. The linked ones are the accounts the console
     * already lists, and their size is the browser's business.
     */
    unlinkedProfiles: Array<{
      id: string;
      fileCount: number;
      sizeBytes: number;
    }>;
  };

  videos: {
    exists: boolean;
    fileCount: number;
    totalBytes: number;
  };

  uploads: {
    exists: boolean;
    fileCount: number;
    totalBytes: number;
    productImages: {
      exists: boolean;
      fileCount: number;
      totalBytes: number;
    };
    brandLogos: {
      exists: boolean;
      fileCount: number;
      totalBytes: number;
    };
  };

  /**
   * Files in the workspace root that none of the sections above owns. The root level only: a file
   * inside a section belongs to that section's numbers, and counting them again here would count
   * a 4,000 file browser profile twice.
   */
  unaccounted: {
    rootFiles: Array<{
      name: string;
      sizeBytes: number;
    }>;
  };

  generatedAt: number;
};

/**
 * The database file, named here rather than asked for from `@/lib/paths`: `@/db/client` resolves a
 * database URL that a configuration may point outside the workspace, so the database layer owns
 * this one entry of the layout. Every section below comes from the boundary.
 */
const DATABASE_FILE_NAME = "social-auto-post.db";
/** SQLite's own sidecars of the database file: they are the database, not loose data beside it. */
const DATABASE_SIDECAR_SUFFIXES = ["-wal", "-shm", "-journal"];
const ACCOUNTS_TABLE = "accounts";
const CONTENT_ITEMS_TABLE = "content_items";

type UnlinkedProfile = WorkspaceManifest["browserProfiles"]["unlinkedProfiles"][number];

function directoryExists(directory: string) {
  return statSync(directory, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

type DirectoryTree = {
  fileCount: number;
  totalBytes: number;
  /** The files directly in the directory: only those a name based reference can point at. */
  files: Array<{ name: string; sizeBytes: number }>;
};

/**
 * Measures a directory tree. Unreadable entries are skipped rather than failing the inventory: a
 * locked browser profile file is a reason to report a smaller number, not to answer with an error.
 */
async function readDirectoryTree(directory: string, direct: boolean): Promise<DirectoryTree> {
  const tree: DirectoryTree = { fileCount: 0, totalBytes: 0, files: [] };
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await readDirectoryTree(entryPath, false);
      tree.fileCount += nested.fileCount;
      tree.totalBytes += nested.totalBytes;
      continue;
    }
    // `stat` rather than the directory entry alone: a symlinked artifact is still an artifact.
    const stats = await fs.stat(entryPath).catch(() => null);
    if (!stats) continue;
    tree.fileCount += 1;
    tree.totalBytes += stats.size;
    if (direct) tree.files.push({ name: entry.name, sizeBytes: stats.size });
  }
  return tree;
}

/** Tables drizzle declares. The delta against the file itself is what `unknownTables` reports. */
function schemaTableNames() {
  const names = new Set<string>();
  for (const value of Object.values(schema)) {
    if (isTable(value)) names.add(getTableName(value));
  }
  return names;
}

/**
 * Where the workspace database is, resolved the way `@/db/client` resolves it: the configured URL
 * wins, except for a relative `file:` URL read from a packaged app, which would point inside the
 * standalone bundle instead of the workspace the user opened.
 */
function resolveDatabaseTarget(root: string) {
  const configured = process.env.SOCIAL_AUTO_POST_DB_URL?.trim();
  const defaultFile = path.join(root, DATABASE_FILE_NAME);
  if (!configured) return defaultFile;
  if (process.env.COOLPILOT_ELECTRON === "1" && /^file:(?!\/|[A-Za-z]:[\\/])/.test(configured)) {
    return defaultFile;
  }
  const normalized = normalizeFileUrl(configured);
  // `normalizeFileUrl` answers `file:C:/x/y.db`; the report speaks paths, and `root` is one too.
  return normalized.startsWith("file:") ? path.normalize(normalized.slice("file:".length)) : configured;
}

type DatabaseInventory = {
  tableCount: number;
  unknownTables: string[];
  /** Account ids: what a `browser-profiles/<id>` directory has to be named after to be linked. */
  accountIds: string[];
  /** File names content references: `contentImageList()`, and nothing else. */
  contentImageNames: Set<string>;
};

function emptyDatabaseInventory(): DatabaseInventory {
  return { tableCount: 0, unknownTables: [], accountIds: [], contentImageNames: new Set() };
}

function parseMetadata(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // A row whose metadata is not JSON is a row with no references this manifest can trust.
    return {};
  }
}

/**
 * Opens the workspace database only once the file is known to be there, because `@libsql/client`
 * creates a missing one as soon as a statement runs on it. Reads only, and through a connection of
 * its own: `@/db/client` opens the same file and runs pending migrations while it is imported.
 */
async function readDatabase(target: string): Promise<DatabaseInventory> {
  if (!path.isAbsolute(target) || !existsSync(target)) return emptyDatabaseInventory();

  const connection = createClient({ url: `file:${target.replace(/\\/g, "/")}` });
  try {
    const tables = await connection.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    );
    const tableNames = tables.rows.map((row) => String(row.name)).sort();
    const declared = schemaTableNames();

    const accountIds = tableNames.includes(ACCOUNTS_TABLE)
      ? (await connection.execute("SELECT id FROM accounts")).rows.map((row) => String(row.id))
      : [];

    const contentImageNames = new Set<string>();
    if (tableNames.includes(CONTENT_ITEMS_TABLE)) {
      const rows = await connection.execute("SELECT image_path, metadata_json FROM content_items");
      for (const row of rows.rows) {
        const references = contentImageList({
          imagePath: row.image_path ? String(row.image_path) : "",
          metadata: parseMetadata(row.metadata_json),
        });
        for (const reference of references) {
          // The serving route answers a request for a path with 404, so a reference counts as a
          // file name: `artifacts/<name>`.
          contentImageNames.add(path.basename(reference));
        }
      }
    }

    return {
      tableCount: tableNames.length,
      unknownTables: tableNames.filter((name) => !declared.has(name)),
      accountIds,
      contentImageNames,
    };
  } catch (error) {
    // An inventory that could not read the database is still worth returning, as long as the
    // caller can tell: everything it would have found in there is reported as absent, with a log
    // line naming the file.
    console.warn(`[workspace] Could not read the database at ${target}:`, error);
    return emptyDatabaseInventory();
  } finally {
    try {
      connection.close();
    } catch {
      // The connection is already gone; nothing left to release.
    }
  }
}

/**
 * Accounts for every root level entry that is not the database, a workspace section or the
 * credential vault. Directories are not listed: their contents are their section's numbers, and a
 * section that counted its files again here would report a 4,000 file browser profile twice.
 */
async function readUnaccountedRootFiles(root: string, databaseTarget: string) {
  const accounted = new Set<string>([
    path.basename(artifactsRoot()),
    path.basename(browserProfilesRoot()),
    path.basename(videosRoot()),
    path.basename(uploadsRoot()),
    ...credentialVaultFileNames,
  ]);
  const databaseNames = new Set([DATABASE_FILE_NAME]);
  if (path.isAbsolute(databaseTarget)) databaseNames.add(path.basename(databaseTarget));
  for (const name of databaseNames) {
    accounted.add(name);
    for (const suffix of DATABASE_SIDECAR_SUFFIXES) accounted.add(`${name}${suffix}`);
  }

  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const rootFiles: Array<{ name: string; sizeBytes: number }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || accounted.has(entry.name)) continue;
    const stats = await fs.stat(path.join(root, entry.name)).catch(() => null);
    if (!stats) continue;
    rootFiles.push({ name: entry.name, sizeBytes: stats.size });
  }
  return rootFiles.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
}

/**
 * Reads the workspace without touching it. Everything below is `stat`, `readdir` and `SELECT`: no
 * directory is created, no database is written, and the workspace that is read is the open one
 * (`dataRoot()`), never a path a caller supplies.
 */
export async function createWorkspaceManifest(): Promise<WorkspaceManifest> {
  const root = dataRoot();
  const databaseTarget = resolveDatabaseTarget(root);
  const database = await readDatabase(databaseTarget);

  const artifacts = await readDirectoryTree(artifactsRoot(), true);
  const linkedArtifacts = artifacts.files.filter((file) => database.contentImageNames.has(file.name)).length;

  const profilesDirectory = browserProfilesRoot();
  const claimedProfiles = new Set(database.accountIds);
  const profileIds = (await fs.readdir(profilesDirectory, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const unlinkedProfiles: UnlinkedProfile[] = [];
  for (const id of profileIds) {
    if (claimedProfiles.has(id)) continue;
    const tree = await readDirectoryTree(path.join(profilesDirectory, id), false);
    unlinkedProfiles.push({ id, fileCount: tree.fileCount, sizeBytes: tree.totalBytes });
  }

  const videosDirectory = videosRoot();
  const uploadsDirectory = uploadsRoot();
  const productImagesDirectory = productImagesRoot();
  const brandLogosDirectory = brandLogosRoot();
  const videos = await readDirectoryTree(videosDirectory, false);
  const uploads = await readDirectoryTree(uploadsDirectory, false);
  const productImages = await readDirectoryTree(productImagesDirectory, false);
  const brandLogos = await readDirectoryTree(brandLogosDirectory, false);

  // A database URL that is not a local file (a remote libsql target) is reported as configured and
  // not probed, and a `stat` on it would only be a guess at a path that is not one.
  const databaseFile = path.isAbsolute(databaseTarget)
    ? statSync(databaseTarget, { throwIfNoEntry: false })
    : undefined;
  // A directory named like the database file is not a database.
  const databaseListed = databaseFile?.isFile() ? databaseFile : undefined;

  return {
    root,
    database: {
      path: databaseTarget,
      exists: databaseListed !== undefined,
      sizeBytes: databaseListed?.size ?? 0,
      tableCount: database.tableCount,
      unknownTables: database.unknownTables,
    },
    artifacts: {
      fileCount: artifacts.fileCount,
      totalBytes: artifacts.totalBytes,
      linked: linkedArtifacts,
      unlinked: artifacts.files.length - linkedArtifacts,
    },
    browserProfiles: {
      total: profileIds.length,
      linked: profileIds.length - unlinkedProfiles.length,
      unlinked: unlinkedProfiles.length,
      unlinkedProfiles,
    },
    videos: {
      exists: directoryExists(videosDirectory),
      fileCount: videos.fileCount,
      totalBytes: videos.totalBytes,
    },
    uploads: {
      exists: directoryExists(uploadsDirectory),
      fileCount: uploads.fileCount,
      totalBytes: uploads.totalBytes,
      productImages: {
        exists: directoryExists(productImagesDirectory),
        fileCount: productImages.fileCount,
        totalBytes: productImages.totalBytes,
      },
      brandLogos: {
        exists: directoryExists(brandLogosDirectory),
        fileCount: brandLogos.fileCount,
        totalBytes: brandLogos.totalBytes,
      },
    },
    unaccounted: { rootFiles: await readUnaccountedRootFiles(root, databaseTarget) },
    generatedAt: Date.now(),
  };
}
