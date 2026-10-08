import { NextResponse } from "next/server";
import { z } from "zod";
import { aiRuntime } from "@/features/ai-runtime";
import { fail, failFromError, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The whiteboard (Drawnix) is served from a different origin than this app, so
 * this endpoint answers CORS requests. It reuses the AI provider, model and key
 * configured in the system settings instead of asking the whiteboard for a key.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function withCors(response: NextResponse) {
  for (const [key, value] of Object.entries(corsHeaders)) {
    response.headers.set(key, value);
  }
  return response;
}

const MINDMAP_SYSTEM_PROMPT = `你是一个专业的思维导图生成助手。根据用户提供的主题，生成一个结构清晰、内容全面的 Markdown 格式思维导图大纲。

要求：
1. 使用 Markdown 标题层级表示思维导图层级：一级标题（#）是中心主题，二级标题（##）是主要分支，三级标题（###）是子分支
2. 内容要全面、有逻辑、结构化，涵盖主题的主要方面
3. 分支数量适中（3-7 个主要分支，每个分支 2-5 个子节点）
4. 每个节点用简洁的短语（不要长句）
5. 只输出 Markdown 内容，不要任何解释、前后缀、代码块标记

示例输出格式：
# 短视频运营
## 内容策划
### 选题方法
### 脚本结构
## 拍摄制作
### 设备选择
### 剪辑技巧
## 发布策略
### 发布时间
### 平台选择`;

const schema = z.object({
  topic: z.string().trim().min(1),
});

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

/**
 * Turns one topic into a Markdown outline that the caller lays out itself.
 *
 * The model call goes straight to `aiRuntime` (batch P3-A3 of `docs/generate-migration-p3.md`): provider
 * order, model choice, key rotation, failover and usage are the runtime's business, while the topic guard,
 * the system literal and the prompt stay this route's. The answer is free text - this route has no schema
 * and asks for no JSON mode - and it is forwarded verbatim as `{ markdown }`: interpreting the outline
 * (headings -> tree, code fences, indentation fallbacks) belongs to the clients, `markdownToMindMap()` in
 * `src/mindmap/mindmap-markdown.ts` for the canvas and `whiteboard/drawnix/utils/llm.ts` for the
 * whiteboard, so nothing of it moved here. A failure keeps the runtime's own vocabulary *and* its HTTP
 * status (D-P3-3) - credentials 400, nothing routable 503, upstream 502 - which is what this route's
 * `failFromError` already passed on; only the legacy `MissingAIKeyError`, which used to flatten all of
 * those into a 500, is gone from the contract. The response carries no provider/model and books no usage
 * row, exactly as before: this endpoint has never charged a run, and adding one would be a business change
 * rather than this migration.
 */
export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return withCors(fail("INVALID_PAYLOAD", 400, parsed.error));
    }
    const response = await aiRuntime.chat({
      messages: [{ role: "user", content: `主题：${parsed.data.topic}\n请输出该主题的 Markdown 思维导图大纲。` }],
      systemPrompt: MINDMAP_SYSTEM_PROMPT,
    });
    return withCors(ok({ markdown: response.text }));
  } catch (error) {
    // No local error taxonomy: `failFromError` keeps an `AppError`'s own code and status (the runtime sets
    // both) and answers anything else - including the body guard above, which runs inside this same `try`
    // and is why the fallback stays `UNKNOWN_ERROR` here instead of an AI-specific code - with a 500.
    return withCors(failFromError(error, "UNKNOWN_ERROR", 500));
  }
}
