import { createResearchMaterial, listResearchMaterials } from "@/db/repositories/research";
import { fail, ok, parseJson } from "@/lib/api";
import { isReadableResearchUrl } from "@/lib/research";
import { researchMaterialInputSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * Research materials (研究素材, CI-P3-01 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * `GET` answers every material, newest edit first: the workspace owns the two filters it offers (search
 * and status) over that list, exactly as the topic and product libraries do, so the route stays one
 * table read.
 *
 * `POST` creates one and decides only what the payload cannot decide honestly: the effective `kind`
 * (an omitted kind with a link is a link, without one it is a note) and the starting status - a record
 * with text is `ready`, one without is `draft`. `empty` and `failed` are not reachable here; they are
 * what reading a source produced, and only `api/research/[id]/fetch` writes them.
 */
export async function GET() {
  return ok(await listResearchMaterials());
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, researchMaterialInputSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
  const input = parsed.data;
  const sourceUrl = input.sourceUrl.trim();
  const kind = input.kind ?? (sourceUrl ? "url" : "text");
  // A link material without a link is not a state this table can express, so it is refused here rather
  // than stored as a `url` row whose url is empty.
  if (kind === "url" && !isReadableResearchUrl(sourceUrl)) {
    return fail("INVALID_PAYLOAD", 400, "a url material needs an http(s) source url");
  }
  return ok(await createResearchMaterial({ ...input, kind, sourceUrl }), { status: 201 });
}
