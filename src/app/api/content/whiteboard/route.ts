import { createContentItem } from "@/db/repository";
import { fail, ok } from "@/lib/api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const data = (await request.json()) as { title?: string; body?: string };
    const title = data?.title || "白板内容";
    const body = data?.body || "";
    const item = await createContentItem({
      title,
      body,
      postReadyText: body,
      metadata: { source: "whiteboard" },
      status: "draft",
    });
    return ok({ item }, { status: 201 });
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to save whiteboard content",
      500
    );
  }
}
