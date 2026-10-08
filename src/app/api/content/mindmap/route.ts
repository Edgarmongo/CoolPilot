import { NextResponse } from "next/server";
import { z } from "zod";
import { generateText } from "@/lib/ai";
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

export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return withCors(fail("INVALID_PAYLOAD", 400, parsed.error));
    }
    const result = await generateText({
      prompt: `主题：${parsed.data.topic}\n请输出该主题的 Markdown 思维导图大纲。`,
      systemPrompt: MINDMAP_SYSTEM_PROMPT,
    });
    return withCors(ok({ markdown: result.text }));
  } catch (error) {
    return withCors(failFromError(error, "UNKNOWN_ERROR", 500));
  }
}
