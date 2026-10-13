import { listPublishedPositions } from "@/db/repositories/positions";
import { appStoreListingIdOfPosition, officialAgents, summarizeAppStore } from "@/lib/app-store-catalog";
import { ok } from "@/lib/api";
import type { AppStoreAgent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const published = await listPublishedPositions();
  const mine: AppStoreAgent[] = published.map((position) => ({
    // CI-P7-05-03: the storefront and the ledger read this id from one helper, so a listing's id
    // cannot mean one thing here and another in a ledger row.
    id: appStoreListingIdOfPosition(position.id),
    name: position.name,
    emoji: position.store.emoji,
    tagline: position.store.tagline,
    description: position.description,
    category: position.store.category,
    tags: [],
    official: false,
    positionId: position.id,
  }));
  return ok(summarizeAppStore([...mine, ...officialAgents]));
}
