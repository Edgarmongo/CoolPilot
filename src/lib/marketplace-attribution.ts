import { appStoreListingIdOfPosition, isAppStoreAgentId } from "./app-store-catalog";
import type { PositionRecord } from "./types";

/**
 * Marketplace extension attribution for the AI usage ledger (CI-P7-05-03).
 *
 * ## What really exists, and what this file refuses to pretend
 *
 * The Marketplace is a **storefront, not an execution entry**: `api/app-store` answers the built-in
 * catalogue plus the user's *published* positions as listings, and the 应用商店 page renders them -
 * there is no "install" and no listing that runs anything by itself. So an extension id can only be
 * stated where a real call site really knows which listing it ran as, and there are exactly two
 * such identities in this codebase:
 *
 *  1. **a published position** - the storefront's own "mine" listing
 *     (`position-<id>`, the id `api/app-store` itself answers). It is a stored record with a publish
 *     state, and `getPosition()`/`getDefaultPosition()` hand it to the generation service, so a
 *     generated article (or a knowledge entry created for one) can name it truthfully;
 *  2. **a built-in catalogue agent** - the id the 应用商店智能体 picker sends as `agentId`, accepted
 *     only when the storefront really lists it (see `isAppStoreAgentId`).
 *
 * Everything else stays unattributed (`''`), which is a statement and not a gap: a chat answer, a
 * transcription, an image call, a rewrite, an extraction or a metrics insight ran as no listing.
 *
 * ## Precedence, and why
 *
 * A stored, published listing wins over a catalogue agent id. The two are different records - the
 * position is the user's own agent with a lifecycle of its own, the catalogue entry is a constant of
 * the build - and the more specific record is the one whose money a reader can go and look at
 * (`position-<id>` resolves to a position row, whose store listing is what a reader can find). If
 * there is no published listing, the catalogue id is used when the entry named one; if neither can
 * be named, the row is unattributed rather than given a plausible-looking id.
 */

/** What a call site really knows about the listing it ran as. An absent field means "named none". */
export interface MarketplaceExtensionSource {
  /**
   * The position the call ran as. `getPosition()`/`getDefaultPosition()` results can be passed
   * directly: the reader only needs the id and the store listing's publish state.
   */
  position?: Pick<PositionRecord, "id" | "store"> | null;
  /** The agent id the entry selected (the generation panel's 应用商店智能体 picker). */
  agentId?: string;
}

/**
 * The extension id this call may state, or `''` when it ran as no listing the storefront publishes.
 *
 * Pure and total: no database, no clock, no lookup. That is what makes it the one place the rule
 * can be read, and what lets every caller - the article service, a route - state the same answer.
 */
export function marketplaceExtensionIdOf(source: MarketplaceExtensionSource): string {
  const position = source.position;
  if (position?.id && position.store?.status === "published") {
    return appStoreListingIdOfPosition(position.id);
  }
  const agentId = source.agentId ?? "";
  return agentId && isAppStoreAgentId(agentId) ? agentId.trim() : "";
}
