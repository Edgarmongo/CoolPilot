import { fail, ok, parseJson } from "@/lib/api";
import { difyDatasetListSchema } from "@/lib/validation";
import type { DifyDatasetSummary } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DifyDatasetPayload = {
  data?: Array<{ id?: unknown; name?: unknown; document_count?: unknown }>;
};

function normalizeBase(apiBase: string) {
  return apiBase.replace(/\/+$/, "");
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, difyDatasetListSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);

  const { apiBase, apiKey } = parsed.data;
  const url = `${normalizeBase(apiBase)}/datasets?page=1&limit=100`;
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    if (!response.ok) {
      return fail(`Dify 返回 HTTP ${response.status}`, 502);
    }
    const payload = (await response.json()) as DifyDatasetPayload;
    const datasets: DifyDatasetSummary[] = (payload.data ?? [])
      .map((item) => ({
        id: String(item.id ?? ""),
        name: String(item.name ?? ""),
        documentCount: Number(item.document_count ?? 0),
      }))
      .filter((item) => item.id);
    return ok({ datasets });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Dify request failed", 502);
  }
}
