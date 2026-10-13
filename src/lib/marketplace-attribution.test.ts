import { describe, expect, it } from "vitest";
import { marketplaceExtensionIdOf } from "./marketplace-attribution";
import { appStoreListingIdOfPosition, officialAgents } from "./app-store-catalog";
import { defaultStoreListing, emptyPositionDraft } from "./positions";
import type { PositionRecord } from "./types";

/**
 * Marketplace extension attribution (CI-P7-05-03).
 *
 * The card asks for an *extension id* on the money. What these cases pin is that the id can only be
 * one the storefront really publishes, and that everything else is left unattributed rather than
 * guessed at - an invented id would make "which extension spent this" look answered.
 */

/** A stored position as the reader sees it: the id plus its store listing's publish state. */
function position(id: string, status: PositionRecord["store"]["status"]): Pick<PositionRecord, "id" | "store"> {
  return { id, store: { ...defaultStoreListing(), status } };
}

describe("marketplace extension attribution", () => {
  it("names a published position by the storefront's own listing id", () => {
    expect(marketplaceExtensionIdOf({ position: position("p-1", "published") })).toBe("position-p-1");
    // The id is the store's, not a second scheme: `api/app-store` answers this exact string.
    expect(marketplaceExtensionIdOf({ position: position("p-1", "published") })).toBe(
      appStoreListingIdOfPosition("p-1"),
    );
  });

  it("refuses to name a position that is not published, because the storefront does not list it", () => {
    for (const status of ["none", "testing", "rejected"] as const) {
      expect(marketplaceExtensionIdOf({ position: position("p-1", status) })).toBe("");
    }
  });

  it("names a catalogue agent id only when the storefront really lists it", () => {
    const listed = officialAgents[0].id;
    expect(marketplaceExtensionIdOf({ agentId: listed })).toBe(listed);
    // The generation panel's picker has two ids of its own; neither is a listing anyone can open.
    expect(marketplaceExtensionIdOf({ agentId: "general" })).toBe("");
    expect(marketplaceExtensionIdOf({ agentId: "marketing" })).toBe("");
    expect(marketplaceExtensionIdOf({ agentId: "  " })).toBe("");
  });

  it("prefers the published listing over a catalogue agent, and takes the agent when there is none", () => {
    const listed = officialAgents[0].id;
    expect(marketplaceExtensionIdOf({ position: position("p-2", "published"), agentId: listed })).toBe(
      "position-p-2",
    );
    expect(marketplaceExtensionIdOf({ position: position("p-2", "none"), agentId: listed })).toBe(listed);
  });

  it("says nothing at all when the call ran as no listing, and never invents one", () => {
    expect(marketplaceExtensionIdOf({})).toBe("");
    expect(marketplaceExtensionIdOf({ position: null, agentId: "" })).toBe("");
    expect(marketplaceExtensionIdOf({ position: position("", "published") })).toBe("");
    // A draft position that has never been saved (`emptyPositionDraft`) is not an attribution either.
    expect(marketplaceExtensionIdOf({ position: { id: "", store: emptyPositionDraft().store } })).toBe("");
  });
});
