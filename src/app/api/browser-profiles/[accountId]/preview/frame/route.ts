import { getBrowserPreviewFrame } from "@/lib/browser-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await context.params;
  const frame = getBrowserPreviewFrame(accountId);

  if (!frame) {
    return new Response("Preview frame not ready", { status: 404 });
  }

  const etag = `"${frame.version}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Cache-Control": "no-cache",
      },
    });
  }

  return new Response(Uint8Array.from(frame.data), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "no-cache",
      ETag: etag,
    },
  });
}