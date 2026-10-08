import { readFile } from "node:fs/promises";
import path from "node:path";
import { artifactsRoot } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contentTypes: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedFile = url.searchParams.get("file") ?? "";
  // Resolved, not initialized: asking for an artifact must not create the section (P5-B0-2.5).
  const root = artifactsRoot();
  const fileName = path.basename(requestedFile);
  const resolved = path.join(root, fileName);
  const ext = path.extname(resolved).toLowerCase();

  if (!requestedFile || fileName !== requestedFile || !contentTypes[ext]) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const file = await readFile(resolved);
    return new Response(file, {
      headers: {
        "Content-Type": contentTypes[ext],
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
