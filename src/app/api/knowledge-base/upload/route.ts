import { createKnowledgeBase } from "@/db/repositories/knowledge-base";
import { fail, failFromError, ok } from "@/lib/api";
import {
  extractTextFromFile,
  isSupportedKnowledgeFile,
  knowledgeUploadMaxBytes,
} from "@/lib/knowledge-file";
import { guessKnowledgeCategory } from "@/lib/knowledge-base";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function stripExtension(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size <= 0) return fail("INVALID_PAYLOAD", 400);
    if (file.size > knowledgeUploadMaxBytes) return fail("INVALID_PAYLOAD", 400, "file too large");
    if (!isSupportedKnowledgeFile(file.name)) return fail("INVALID_PAYLOAD", 400, "unsupported file type");

    const positionIdValue = formData.get("positionId");
    const positionId = typeof positionIdValue === "string" ? positionIdValue.trim() : "";

    const buffer = Buffer.from(await file.arrayBuffer());
    const text = extractTextFromFile(file.name, buffer).trim();
    if (!text) return fail("INVALID_PAYLOAD", 400, "no extractable text");

    const title = stripExtension(file.name).trim() || file.name;
    const item = await createKnowledgeBase({
      title,
      content: text,
      category: guessKnowledgeCategory(`${title}\n${text.slice(0, 500)}`),
      weight: "medium",
      origin: "file",
      fileName: file.name,
      positionId,
    });
    return ok({ item }, { status: 201 });
  } catch (error) {
    return failFromError(error);
  }
}
