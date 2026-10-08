import type { TranslationKey } from "@/lib/locale-resources";
import type { WorkspaceManifest } from "./manifest";

/**
 * P5-B0-3-B: the manifest arranged into the five things the Workspace Overview shows.
 *
 * The manifest answers "what is in this workspace"; it does not answer "which of these numbers is
 * worth a card, and in what order". That second question is a product decision, so it lives here
 * and not in the page - a component that decided it would be able to describe a workspace the
 * manifest never reported.
 *
 * Two rules make this layer what it is:
 *
 *   - **Every user-visible word is a dictionary key.** A row carries the key of its label, its
 *     headline value and each part of its second line; the console translates them (`src/lib/i18n`,
 *     `src/lib/locale-resources`). Nothing here concatenates English, so a new locale is a new
 *     locale file and not a new branch. The one exception is a size: "913 KB" is a number and a
 *     unit symbol, which no locale spells differently, so it travels as `text` - computed by
 *     `formatBytes()` and pinned by the tests beside this file.
 *   - **Nothing is decided from a re-read.** Every field comes from the manifest it was handed:
 *     this module never stats a file, opens the database or asks `@/lib/paths` anything, so the
 *     overview and the API that feeds it cannot disagree about the workspace.
 *
 * What it deliberately does not do: it never turns a number into an offer. `unlinked profiles`
 * names directories that could be deleted, and P5-B0-3-B still only reports them - the counts and
 * the names are the entry point a later Workspace capability will hang off, and inventing a
 * cleanup that the API cannot answer for would be a console telling the user to delete data it has
 * not read.
 *
 * Sections of the manifest that are intentionally not shown yet: `uploads` with its
 * `productImages` and `brandLogos` children. They are the "Data → Images" surface of the roadmap,
 * not part of the first overview, and a row nobody has designed a destination for would only be a
 * number without a place to go.
 */

/**
 * A piece of one line of the report: either something a dictionary word is needed for, or a value
 * that is already final in every locale (a byte size, a count, the em dash of an absent value).
 */
export type WorkspaceFactPart =
  | { key: TranslationKey; values?: Record<string, string | number> }
  | { text: string };

export type WorkspaceSectionId = "database" | "artifacts" | "browserProfiles" | "videos";

export type WorkspaceSectionRow = {
  id: WorkspaceSectionId;
  labelKey: TranslationKey;
  /** The headline: a size, a count of files, a count of profiles. */
  primary: WorkspaceFactPart;
  /** The second line, rendered as `a · b`: how the number is made up. */
  secondary: WorkspaceFactPart[];
  /**
   * The section holds nothing yet. It is shown, not hidden, and shown quietly: an empty videos
   * folder is a fact about the workspace, and a report that dropped empty sections would make an
   * empty install indistinguishable from one whose reader is broken.
   */
  empty: boolean;
};

export type WorkspaceAttentionId = "unlinkedProfiles" | "unknownTables" | "unaccountedFiles";

export type WorkspaceAttentionItem = {
  id: WorkspaceAttentionId;
  labelKey: TranslationKey;
  /** Everything of this kind, not only the names below. */
  count: number;
  /** Up to `WORKSPACE_ATTENTION_NAME_LIMIT` names, sorted, so the panel reads at any size. */
  names: string[];
};

export type WorkspaceOverview = {
  root: string;
  generatedAt: number;
  rows: WorkspaceSectionRow[];
  /** Only the kinds with something to report, in a fixed order. */
  attention: WorkspaceAttentionItem[];
  /**
   * The size of the attention inbox: every entry the items below name, counted across kinds. It is
   * what the card's "3 items" says, and it is a sum rather than a kind count because the user is
   * being told how many things to look at, not how many categories exist.
   */
  attentionCount: number;
};

/** How many names an attention item spells out before it becomes "and N more". */
export const WORKSPACE_ATTENTION_NAME_LIMIT = 8;

const byteUnits = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * Bytes as a console reads them: whole bytes, one decimal for KB ("913 KB"), two from MB
 * ("4.42 MB"), and no trailing ".0" - a report that said "913.0 KB" would quote a precision the
 * measurement does not have. A missing or nonsensical size reads as "0 B" rather than "NaN B".
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < byteUnits.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const digits = unit === 0 ? 0 : unit === 1 ? 1 : 2;
  return `${Number(value.toFixed(digits))} ${byteUnits[unit]}`;
}

function fact(key: TranslationKey, values?: Record<string, string | number>): WorkspaceFactPart {
  return { key, values };
}

function value(text: string): WorkspaceFactPart {
  return { text };
}

function attentionItem(
  id: WorkspaceAttentionId,
  labelKey: TranslationKey,
  count: number,
  names: string[],
): WorkspaceAttentionItem {
  return { id, labelKey, count, names: [...names].sort().slice(0, WORKSPACE_ATTENTION_NAME_LIMIT) };
}

export function buildWorkspaceOverview(manifest: WorkspaceManifest): WorkspaceOverview {
  const { database, artifacts, browserProfiles, videos } = manifest;
  const unknownTables = database.unknownTables.length;

  const rows: WorkspaceSectionRow[] = [
    {
      id: "database",
      labelKey: "wsSectionDatabase",
      // A database that is not there has no size to quote. The dash says "not measured" and the
      // second line says why, so the two never contradict each other.
      primary: database.exists ? value(formatBytes(database.sizeBytes)) : value("—"),
      secondary: database.exists
        ? [
            fact("wsDetailDatabaseTables", { count: database.tableCount }),
            ...(unknownTables ? [fact("wsDetailDatabaseUnknownTables", { count: unknownTables })] : []),
          ]
        : [fact("wsDetailDatabaseMissing")],
      empty: !database.exists,
    },
    {
      id: "artifacts",
      labelKey: "wsSectionArtifacts",
      // Files, not bytes: "how much content imagery do I have" is answered by how many the content
      // can reference, and the size is the second line.
      primary: fact("wsUnitFiles", { count: artifacts.fileCount }),
      secondary: artifacts.fileCount
        ? [
            // Linked is not a quality claim: an artifact file nothing references yet is the normal
            // state of a workspace between two generations, so it stays in this line and out of the
            // attention list below.
            fact("wsDetailLinkedUnlinked", { linked: artifacts.linked, unlinked: artifacts.unlinked }),
            value(formatBytes(artifacts.totalBytes)),
          ]
        : [fact("wsDetailEmpty")],
      empty: artifacts.fileCount === 0,
    },
    {
      id: "browserProfiles",
      labelKey: "wsSectionProfiles",
      primary: value(String(browserProfiles.total)),
      secondary: browserProfiles.total
        ? [fact("wsDetailLinkedUnlinked", { linked: browserProfiles.linked, unlinked: browserProfiles.unlinked })]
        : [fact("wsDetailEmpty")],
      empty: browserProfiles.total === 0,
    },
    {
      id: "videos",
      labelKey: "wsSectionVideos",
      primary: fact("wsUnitFiles", { count: videos.fileCount }),
      // `exists` is known here, so this line can be specific: an absent folder and an empty one are
      // different facts, and only one of them means the user has never put a video there.
      secondary: !videos.exists
        ? [fact("wsDetailFolderMissing")]
        : videos.fileCount
          ? [value(formatBytes(videos.totalBytes))]
          : [fact("wsDetailEmpty")],
      empty: videos.fileCount === 0,
    },
  ];

  const attention = [
    attentionItem(
      "unlinkedProfiles",
      "wsAttentionUnlinkedProfiles",
      browserProfiles.unlinked,
      browserProfiles.unlinkedProfiles.map((profile) => profile.id),
    ),
    // Tables the drizzle schema does not declare (P5-B0-1: `accounts` rows living inside `sites`)
    // are data the user has and this build cannot read. Absence of a reader is not absence of data,
    // so they are reported rather than quietly dropped.
    attentionItem("unknownTables", "wsAttentionUnknownTables", unknownTables, database.unknownTables),
    attentionItem(
      "unaccountedFiles",
      "wsAttentionUnaccountedFiles",
      manifest.unaccounted.rootFiles.length,
      manifest.unaccounted.rootFiles.map((file) => file.name),
    ),
  ].filter((item) => item.count > 0);

  return {
    root: manifest.root,
    generatedAt: manifest.generatedAt,
    rows,
    attention,
    attentionCount: attention.reduce((total, item) => total + item.count, 0),
  };
}
