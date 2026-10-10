import { describe, expect, it } from "vitest";
import { locales } from "@/lib/i18n-config";
import { localeResources } from "@/lib/locale-resources";
import type { TranslationKey } from "@/lib/locale-resources";
import type { WorkspaceManifest } from "./manifest";
import {
  buildWorkspaceOverview,
  formatBytes,
  WORKSPACE_ATTENTION_NAME_LIMIT,
  type WorkspaceFactPart,
  type WorkspaceOverview,
} from "./overview";

/**
 * P5-B0-3-B: the Workspace Overview, which is the manifest plus the decisions about what is worth
 * showing.
 *
 * The page itself is not tested here, and that is the point of `overview.ts` existing: what the
 * console draws is `buildWorkspaceOverview(manifest)`, so the interesting half - which rows there
 * are, which numbers are the headline, what counts as "needs attention", what happens to a
 * workspace with nothing in it - is pinned without rendering React.
 *
 * The assertions below name dictionary keys rather than English text on purpose. The words change
 * (and three locale files have to agree on them, see `dictionaries.test.ts`); which *facts* the
 * console shows is the contract, and a test written against a translated sentence would fail for
 * the wrong reason the day the copy is edited.
 *
 * Two of them are worth their own paragraph:
 *
 *   - `formatBytes()` is the only place in this feature that builds a user-visible string, so it is
 *     tested at the edges: zero, the 1024 boundary, the one-decimal KB and two-decimal MB readings,
 *     and a value a report should never print as "NaN".
 *   - The attention list is derived, not copied: an item exists only when something of that kind is
 *     actually there, the names are sorted and capped while the count stays complete, and the
 *     headline number is the sum across kinds. A workspace with nothing to report must produce an
 *     empty list, not three rows of "0".
 */

type ManifestPatch = {
  root?: string;
  generatedAt?: number;
  database?: Partial<WorkspaceManifest["database"]>;
  artifacts?: Partial<WorkspaceManifest["artifacts"]>;
  browserProfiles?: Partial<WorkspaceManifest["browserProfiles"]>;
  videos?: Partial<WorkspaceManifest["videos"]>;
  unaccounted?: Partial<WorkspaceManifest["unaccounted"]>;
};

/** A workspace where every section is present in the manifest and empty on disk. */
function emptyWorkspace(): WorkspaceManifest {
  return {
    root: "C:/workspace",
    database: { path: "C:/workspace/social-auto-post.db", exists: false, sizeBytes: 0, tableCount: 0, unknownTables: [] },
    artifacts: { fileCount: 0, totalBytes: 0, linked: 0, unlinked: 0 },
    browserProfiles: { total: 0, linked: 0, unlinked: 0, unlinkedProfiles: [] },
    videos: { exists: false, fileCount: 0, totalBytes: 0 },
    media: { exists: false, fileCount: 0, totalBytes: 0 },
    uploads: {
      exists: false,
      fileCount: 0,
      totalBytes: 0,
      productImages: { exists: false, fileCount: 0, totalBytes: 0 },
      brandLogos: { exists: false, fileCount: 0, totalBytes: 0 },
    },
    unaccounted: { rootFiles: [] },
    generatedAt: 1_700_000_000_000,
  };
}

function makeWorkspace(patch: ManifestPatch = {}): WorkspaceManifest {
  const base = emptyWorkspace();
  return {
    root: patch.root ?? base.root,
    generatedAt: patch.generatedAt ?? base.generatedAt,
    database: { ...base.database, ...patch.database },
    artifacts: { ...base.artifacts, ...patch.artifacts },
    browserProfiles: { ...base.browserProfiles, ...patch.browserProfiles },
    videos: { ...base.videos, ...patch.videos },
    media: base.media,
    uploads: base.uploads,
    unaccounted: { ...base.unaccounted, ...patch.unaccounted },
  };
}

/** A workspace that looks like a used install: everything present, something in every section. */
function usedWorkspace(): WorkspaceManifest {
  return makeWorkspace({
    database: { exists: true, sizeBytes: 935_000, tableCount: 29, unknownTables: ["sites_old"] },
    artifacts: { fileCount: 37, totalBytes: 4_635_000, linked: 35, unlinked: 2 },
    browserProfiles: {
      total: 7,
      linked: 5,
      unlinked: 2,
      unlinkedProfiles: [
        { id: "9ed0", fileCount: 12, sizeBytes: 4096 },
        { id: "1a2b", fileCount: 30, sizeBytes: 9000 },
      ],
    },
    videos: { exists: true, fileCount: 3, totalBytes: 2_100_000 },
    unaccounted: { rootFiles: [{ name: "_tmp-e2e.db", sizeBytes: 4096 }] },
  });
}

function overviewOf(manifest: WorkspaceManifest) {
  return buildWorkspaceOverview(manifest);
}

function rowOf(overview: WorkspaceOverview, id: WorkspaceOverview["rows"][number]["id"]) {
  const row = overview.rows.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`No overview row for ${id}`);
  return row;
}

function partKey(part: WorkspaceFactPart): string {
  return "text" in part ? `text:${part.text}` : `${part.key}:${JSON.stringify(part.values ?? {})}`;
}

function collectKeys(overview: WorkspaceOverview) {
  const keys: TranslationKey[] = [];
  const collectParts = (parts: WorkspaceFactPart[]) => {
    for (const part of parts) if (!("text" in part)) keys.push(part.key);
  };

  for (const row of overview.rows) {
    keys.push(row.labelKey);
    collectParts([row.primary]);
    collectParts(row.secondary);
  }
  for (const item of overview.attention) keys.push(item.labelKey);
  return keys;
}

describe("formatBytes", () => {
  it("reads sizes the way a console does", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(935_000)).toBe("913.1 KB");
    expect(formatBytes(1024 * 1024 * 4.42)).toBe("4.42 MB");
    expect(formatBytes(1024 ** 3 * 2)).toBe("2 GB");
  });

  it("never prints an unmeasurable size", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-1)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
  });

  it("stops at its largest unit instead of inventing one", () => {
    expect(formatBytes(1024 ** 5)).toBe("1024 TB");
  });
});

describe("workspace overview rows", () => {
  it("always reports the same four sections, in the same order", () => {
    expect(overviewOf(emptyWorkspace()).rows.map((row) => row.id)).toEqual([
      "database",
      "artifacts",
      "browserProfiles",
      "videos",
    ]);
  });

  it("shows a workspace with nothing in it as empty, never as broken", () => {
    const overview = overviewOf(emptyWorkspace());

    expect(overview.rows.map((row) => row.empty)).toEqual([true, true, true, true]);
    // No database is "not measured" plus the reason, not a size of zero.
    expect(partKey(rowOf(overview, "database").primary)).toBe("text:—");
    expect(rowOf(overview, "database").secondary.map(partKey)).toEqual(["wsDetailDatabaseMissing:{}"]);
    expect(partKey(rowOf(overview, "artifacts").primary)).toBe('wsUnitFiles:{"count":0}');
    expect(rowOf(overview, "artifacts").secondary.map(partKey)).toEqual(["wsDetailEmpty:{}"]);
    expect(partKey(rowOf(overview, "browserProfiles").primary)).toBe("text:0");
    expect(partKey(rowOf(overview, "videos").primary)).toBe('wsUnitFiles:{"count":0}');
    // `exists: false` is known, so this line is specific rather than a generic empty.
    expect(rowOf(overview, "videos").secondary.map(partKey)).toEqual(["wsDetailFolderMissing:{}"]);
  });

  it("measures the database before it names its tables", () => {
    const overview = overviewOf(usedWorkspace());

    expect(partKey(rowOf(overview, "database").primary)).toBe("text:913.1 KB");
    expect(rowOf(overview, "database").secondary.map(partKey)).toEqual([
      'wsDetailDatabaseTables:{"count":29}',
      'wsDetailDatabaseUnknownTables:{"count":1}',
    ]);
    expect(rowOf(overview, "database").empty).toBe(false);
  });

  it("leaves the unknown-table part out when this build can read every table", () => {
    const overview = overviewOf(makeWorkspace({ database: { exists: true, sizeBytes: 4096, tableCount: 29 } }));

    expect(rowOf(overview, "database").secondary.map(partKey)).toEqual(['wsDetailDatabaseTables:{"count":29}']);
  });

  it("counts artifact files, and says how many of them content references", () => {
    const row = rowOf(overviewOf(usedWorkspace()), "artifacts");

    expect(partKey(row.primary)).toBe('wsUnitFiles:{"count":37}');
    expect(row.secondary.map(partKey)).toEqual(['wsDetailLinkedUnlinked:{"linked":35,"unlinked":2}', "text:4.42 MB"]);
    expect(row.empty).toBe(false);
  });

  it("counts browser profiles, linked and not", () => {
    const row = rowOf(overviewOf(usedWorkspace()), "browserProfiles");

    expect(partKey(row.primary)).toBe("text:7");
    expect(row.secondary.map(partKey)).toEqual(['wsDetailLinkedUnlinked:{"linked":5,"unlinked":2}']);
  });

  it("separates an empty videos folder from one that was never created", () => {
    const empty = overviewOf(makeWorkspace({ videos: { exists: true } }));
    expect(rowOf(empty, "videos").secondary.map(partKey)).toEqual(["wsDetailEmpty:{}"]);

    const withFiles = overviewOf(makeWorkspace({ videos: { exists: true, fileCount: 3, totalBytes: 2_100_000 } }));
    expect(rowOf(withFiles, "videos").secondary.map(partKey)).toEqual(["text:2 MB"]);
    expect(rowOf(withFiles, "videos").empty).toBe(false);
  });
});

describe("workspace overview attention", () => {
  it("reports nothing when there is nothing to report", () => {
    const overview = overviewOf(emptyWorkspace());

    expect(overview.attention).toEqual([]);
    expect(overview.attentionCount).toBe(0);
  });

  it("lists what nothing in the workspace points at, in a fixed order", () => {
    const overview = overviewOf(usedWorkspace());

    expect(overview.attention.map((item) => item.id)).toEqual(["unlinkedProfiles", "unknownTables", "unaccountedFiles"]);
    expect(overview.attention.map((item) => item.labelKey)).toEqual([
      "wsAttentionUnlinkedProfiles",
      "wsAttentionUnknownTables",
      "wsAttentionUnaccountedFiles",
    ]);
    expect(overview.attention.map((item) => item.count)).toEqual([2, 1, 1]);
    // Sorted for reading: the manifest counted the names, the panel only spells some of them out.
    expect(overview.attention[0].names).toEqual(["1a2b", "9ed0"]);
    expect(overview.attentionCount).toBe(4);
  });

  it("drops a kind with nothing in it instead of printing a zero", () => {
    const overview = overviewOf(makeWorkspace({ database: { exists: true, sizeBytes: 4096, tableCount: 29 } }));

    expect(overview.attention).toEqual([]);
    expect(overview.attentionCount).toBe(0);
  });

  it("caps the names it prints without shrinking the count", () => {
    const rootFiles = Array.from({ length: WORKSPACE_ATTENTION_NAME_LIMIT + 4 }, (_, index) => ({
      name: `stray-${String(index).padStart(2, "0")}.db`,
      sizeBytes: 4096,
    }));

    const [item] = overviewOf(makeWorkspace({ unaccounted: { rootFiles } })).attention;

    expect(item.id).toBe("unaccountedFiles");
    expect(item.names).toHaveLength(WORKSPACE_ATTENTION_NAME_LIMIT);
    expect(item.names[0]).toBe("stray-00.db");
    expect(item.count).toBe(WORKSPACE_ATTENTION_NAME_LIMIT + 4);
  });

  it("keeps unlinked artifact files out of the attention list", () => {
    // Two different questions: the section line answers "how much of my imagery does content use",
    // and an artifact nothing references yet is the normal state between two generations.
    const overview = overviewOf(
      makeWorkspace({ artifacts: { fileCount: 4, totalBytes: 1024, linked: 1, unlinked: 3 } }),
    );

    expect(rowOf(overview, "artifacts").secondary.map(partKey)[0]).toBe(
      'wsDetailLinkedUnlinked:{"linked":1,"unlinked":3}',
    );
    expect(overview.attention).toEqual([]);
  });
});

describe("workspace overview contract", () => {
  it("reports the workspace it was handed, without reading anything itself", () => {
    const overview = overviewOf(makeWorkspace({ root: "D:/another-workspace", generatedAt: 42 }));

    expect(overview.root).toBe("D:/another-workspace");
    expect(overview.generatedAt).toBe(42);
  });

  it("asks for exactly the words B0-3-B decided to show", () => {
    expect([...new Set(collectKeys(overviewOf(usedWorkspace())))].sort()).toEqual([
      "wsAttentionUnaccountedFiles",
      "wsAttentionUnknownTables",
      "wsAttentionUnlinkedProfiles",
      "wsDetailDatabaseTables",
      "wsDetailDatabaseUnknownTables",
      "wsDetailLinkedUnlinked",
      "wsSectionArtifacts",
      "wsSectionDatabase",
      "wsSectionProfiles",
      "wsSectionVideos",
      "wsUnitFiles",
    ].sort());
  });

  it("only uses keys every locale file can answer", () => {
    // The page renders these through `useI18n()`, which falls back to the key itself when a
    // dictionary has no entry - a missing translation would surface as `wsSectionDatabase` on a
    // zh-HK screen rather than as a failing test. This is where that becomes a failing test.
    const keys = [
      ...collectKeys(overviewOf(usedWorkspace())),
      ...collectKeys(overviewOf(emptyWorkspace())),
    ];

    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      for (const locale of locales) {
        expect(localeResources[locale][key], `${locale}.${key}`).not.toHaveLength(0);
      }
    }
  });
});
