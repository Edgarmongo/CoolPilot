import { createResearchMaterial } from "@/db/repositories/research";
import { fail, failFromError, ok } from "@/lib/api";
import { extractTextFromFile, isSupportedKnowledgeFile, knowledgeUploadMaxBytes } from "@/lib/knowledge-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function stripExtension(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Imports an existing local file as a research material (P3-01-01/02 of
 * `docs/coolpilot-capability-integration-plan.md`).
 *
 * The file handling is the knowledge base's own (`@/lib/knowledge-file`): the same extensions, the same
 * size ceiling and the same extractor, so a docx that the knowledge library can read is readable here and
 * a format neither supports is refused with the same 400 - no second, differently-behaving importer.
 *
 * What differs is the outcome when the file turns out to hold no text: the knowledge route refuses the
 * upload, while this one records the material as `empty` and says why, because the card asks for a real
 * state on the record rather than a disappearing upload. The text is never guessed from the file name.
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size <= 0) return fail("INVALID_PAYLOAD", 400);
    if (file.size > knowledgeUploadMaxBytes) return fail("INVALID_PAYLOAD", 400, "file too large");
    if (!isSupportedKnowledgeFile(file.name)) return fail("INVALID_PAYLOAD", 400, "unsupported file type");

    const text = extractTextFromFile(file.name, Buffer.from(await file.arrayBuffer())).trim();
    const item = await createResearchMaterial({
      title: stripExtension(file.name).trim() || file.name,
      kind: "file",
      content: text,
      fileName: file.name,
      ...(text
        ? { status: "ready" as const }
        : { status: "empty" as const, statusMessage: "文件里没有可提取的正文" }),
    });
    return ok({ item }, { status: 201 });
  } catch (error) {
    return failFromError(error);
  }
}
