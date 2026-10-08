import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { fail, failFromError, ok } from "@/lib/api";
import { ensureProductImagesRoot, productImagesRoot } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const allowedTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);

const contentTypes: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** Maps a client-supplied file name to an in-root path, or null when invalid. */
function resolveRequestedFile(requested: string) {
  const fileName = path.basename(requested);
  if (!requested || fileName !== requested) return null;
  if (!contentTypes[path.extname(fileName).toLowerCase()]) return null;
  return path.join(productImagesRoot(), fileName);
}

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("file") ?? "";
  const resolved = resolveRequestedFile(requested);
  if (!resolved) return new Response("Not found", { status: 404 });
  try {
    const file = await readFile(resolved);
    return new Response(file, {
      headers: {
        "Content-Type": contentTypes[path.extname(resolved).toLowerCase()],
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return fail("INVALID_PAYLOAD", 400);
    const extension = allowedTypes.get(file.type);
    if (!extension || file.size <= 0 || file.size > MAX_IMAGE_SIZE) {
      return fail("INVALID_PAYLOAD", 400);
    }
    // The upload is the writer of this section, so it initializes what it is about to fill.
    const root = ensureProductImagesRoot();
    const filePath = path.join(root, `product-${Date.now()}-${nanoid(8)}${extension}`);
    await writeFile(filePath, Buffer.from(await file.arrayBuffer()));
    return ok(
      { imagePath: filePath, imageUrl: `/api/products/image?file=${path.basename(filePath)}` },
      { status: 201 },
    );
  } catch (error) {
    return failFromError(error);
  }
}

export async function DELETE(request: Request) {
  const requested = new URL(request.url).searchParams.get("file") ?? "";
  const resolved = resolveRequestedFile(requested);
  if (!resolved) return fail("INVALID_PAYLOAD", 400);
  await rm(resolved, { force: true });
  return ok({ deleted: true });
}
