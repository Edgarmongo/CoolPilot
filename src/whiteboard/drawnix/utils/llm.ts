const WHITEBOARD_API_BASE_PARAM = 'apiBase';

/** The hosting app hands us its API base so we reuse the system AI configuration. */
export const resolveApiBase = (): string => {
  try {
    const base = new URLSearchParams(window.location.search).get(
      WHITEBOARD_API_BASE_PARAM
    );
    if (base) {
      return base.replace(/\/$/, '');
    }
  } catch {
    // ignore
  }
  return window.location.origin;
};

export const generateMindMapMarkdown = async (
  topic: string
): Promise<string> => {
  const response = await fetch(`${resolveApiBase()}/api/content/mindmap`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ topic }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI 请求失败 (${response.status}): ${errorText.slice(0, 200)}`);
  }

  const payload = await response.json();
  const markdown = payload?.data?.markdown ?? payload?.markdown;
  if (!markdown) {
    throw new Error('AI 未返回有效内容');
  }
  return String(markdown).trim();
};

export const generateMindMapMarkdownStream = async (
  topic: string,
  onChunk: (text: string) => void
): Promise<string> => {
  const markdown = await generateMindMapMarkdown(topic);
  onChunk(markdown);
  return markdown;
};
