import { getPosition } from "@/db/repositories/positions";
import { marketplaceExtensionIdOf } from "./marketplace-attribution";
import type { ContentItem } from "./types";

/**
 * The Marketplace listing an *already-stored* article names (CI-P7-05-03, remaining surface).
 *
 * Two ledger write paths had no attribution because the call that spends the money is not the call that
 * chose the listing: 改写 (`content/[id]/rewrite`) and 翻译 (`content/[id]/translate`) arrive with an
 * article id, and 效果解读 (`metrics/insights`) arrives with a publish record. None of them carries a
 * picker or a positioning, so what they can read is what the generation *stored* about the article:
 *
 * - `metadata.positioningId` is the position `generateArticle()` really resolved - the record it read,
 *   not the id the caller asked for, which is why an id that named nothing stays `""` there.
 * - `metadata.agentId` is the 应用商店智能体 the generation panel selected.
 *
 * Both are facts the generation wrote down, so these paths state what happened instead of inferring an
 * extension from the page, the editor's dialog or the article's title - the kind of guess CI-P7-05-03
 * refuses. A stored position that the storefront no longer lists, and a picker-only agent id such as
 * `general`, are not listings and leave the rows unattributed.
 *
 * What this module deliberately does *not* own is the rule: `marketplaceExtensionIdOf()` decides what a
 * listing id looks like and whether a source is one, so a rewrite, a translation, an insight and a
 * generation all answer "which extension was this" the same way. This file only reads the provenance and
 * hands it over, which is also why it may not grow a second opinion about published positions.
 */

/** The two provenance ids a stored article carries about what it was written as. */
export interface ContentItemListingProvenance {
  /** `metadata.positioningId`: the position the generation resolved, `""` when it resolved none. */
  positionId: string;
  /** `metadata.agentId`: the catalogue agent the entry selected, `""` when it selected none. */
  agentId: string;
}

/**
 * Reads those two ids off an article's metadata.
 *
 * Anything that is not a string is no id at all - an old item, a hand-edited row or a metadata shape
 * this module has never seen all answer `""` rather than throwing, because "there is nothing to
 * attribute here" is a normal answer for a stored article.
 */
export function contentItemListingProvenance(
  metadata: ContentItem["metadata"] | null | undefined,
): ContentItemListingProvenance {
  const record = metadata ?? {};
  return {
    positionId: typeof record.positioningId === "string" ? record.positioningId.trim() : "",
    agentId: typeof record.agentId === "string" ? record.agentId.trim() : "",
  };
}

/**
 * The Marketplace extension a stored article's own provenance names, or `""` when it names none.
 *
 * Asynchronous because *the article* does not store whether its listing is published - the position
 * record does, and only the storefront's own filter can answer it. That read is the one thing this
 * module cannot derive from the item, and it is why the bridge exists at all: the call sites get the
 * same verdict as the generation, without any of them re-implementing it.
 *
 * An item that does not exist and an item with no provenance are the same answer: nothing to name.
 */
export async function marketplaceExtensionIdOfContentItem(
  item: Pick<ContentItem, "metadata"> | null | undefined,
): Promise<string> {
  const provenance = contentItemListingProvenance(item?.metadata);
  const position = provenance.positionId ? await getPosition(provenance.positionId) : null;
  return marketplaceExtensionIdOf({ position, agentId: provenance.agentId });
}
