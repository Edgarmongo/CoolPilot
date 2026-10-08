"use client";

import * as React from "react";
import useSWR, { useSWRConfig } from "swr";
import { useSearchParams } from "next/navigation";
import { ArrowUp, Check, ChevronDown, Copy, Loader2, MessageSquare, Plus } from "lucide-react";
import type { AgentChatMessageWithTools, AgentChatThreadRecord } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { apiPost, swrFetcher } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const ACTIVE_THREAD_STORAGE_KEY = "agent-chat-active-thread-id";

type ChatHistoryResponse = {
  thread: AgentChatThreadRecord | null;
  messages: AgentChatMessageWithTools[];
};

/** Compact tool-call pill shown under an assistant turn. */
function ToolCallChip({ tool }: { tool: AgentChatMessageWithTools["toolCalls"][number] }) {
  const [open, setOpen] = React.useState(false);
  const running = tool.status === "running" || tool.status === "pending";
  const tone =
    tool.status === "completed"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tool.status === "failed"
        ? "border-rose-200 bg-rose-50 text-rose-700"
        : "border-amber-200 bg-amber-50 text-amber-700";
  const detail = JSON.stringify({ input: tool.input, output: tool.output }, null, 2);
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn("inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition", tone)}
      >
        {running ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
        <code className="font-mono">{tool.name}</code>
        <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <pre className="max-h-72 overflow-auto rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-[11px] leading-5 text-zinc-600">
          {detail}
        </pre>
      ) : null}
    </div>
  );
}

function AssistantTurn({ message }: { message: AgentChatMessageWithTools }) {
  const { locale } = useI18n();
  const [copied, setCopied] = React.useState(false);
  const [resuming, setResuming] = React.useState(false);
  const localAgentRunId = typeof message.metadata.localAgentRunId === "string" ? message.metadata.localAgentRunId : "";
  const isPaused = message.metadata.localAgentStatus === "paused" && Boolean(localAgentRunId);

  async function resume(approved: boolean) {
    if (!localAgentRunId || resuming) return;
    setResuming(true);
    try {
      await apiPost(`/api/agent/runs/${encodeURIComponent(localAgentRunId)}/resume`, { approved, input: { locale } });
    } finally {
      setResuming(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="group flex flex-col gap-2">
      <div className="whitespace-pre-wrap break-words text-[15px] leading-7 text-zinc-800">{message.content}</div>
      {message.toolCalls.length ? (
        <div className="flex flex-col gap-2 pt-1">
          {message.toolCalls.map((tool) => (
            <ToolCallChip key={tool.id} tool={tool} />
          ))}
        </div>
      ) : null}
      {isPaused ? (
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            disabled={resuming}
            onClick={() => void resume(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-700 disabled:opacity-60"
          >
            {resuming ? <Loader2 className="size-3 animate-spin" /> : null}
            Continue
          </button>
          <button
            type="button"
            disabled={resuming}
            onClick={() => void resume(false)}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-60"
          >
            Stop
          </button>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => void copy()}
        className="flex w-fit items-center gap-1 text-xs text-zinc-400 opacity-0 transition hover:text-zinc-600 group-hover:opacity-100"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        Copy
      </button>
    </div>
  );
}

/** ChatGPT-style conversation surface: history rail on the left, chat column on the right. */
export function ChatConversation() {
  const { t, locale } = useI18n();
  const searchParams = useSearchParams();
  const { mutate: mutateCache } = useSWRConfig();
  const initialThreadId = searchParams.get("threadId") ?? "";
  const draftToken = searchParams.get("newChat") ?? "";

  const [threadId, setThreadId] = React.useState(() => {
    if (initialThreadId) return initialThreadId;
    if (draftToken || typeof window === "undefined") return "";
    return window.localStorage.getItem(ACTIVE_THREAD_STORAGE_KEY) ?? "";
  });
  const [input, setInput] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [pendingUserMessage, setPendingUserMessage] = React.useState<AgentChatMessageWithTools | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const { data: threads = [], mutate: mutateThreads } = useSWR<AgentChatThreadRecord[]>(
    "/api/agent/chat/threads?limit=200",
    swrFetcher,
  );
  const chatUrl = threadId ? `/api/agent/chat?threadId=${encodeURIComponent(threadId)}` : null;
  const { data, isLoading, mutate } = useSWR<ChatHistoryResponse>(chatUrl, swrFetcher);

  const messages = data?.messages ?? [];
  const renderedMessages = React.useMemo(
    () => (pendingUserMessage ? [...messages, pendingUserMessage] : messages),
    [messages, pendingUserMessage],
  );

  React.useEffect(() => {
    if (!initialThreadId || initialThreadId === threadId) return;
    window.queueMicrotask(() => {
      setThreadId(initialThreadId);
      window.localStorage.setItem(ACTIVE_THREAD_STORAGE_KEY, initialThreadId);
    });
  }, [initialThreadId, threadId]);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [renderedMessages.length, submitting]);

  const resize = React.useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, []);

  React.useEffect(() => {
    resize();
  }, [resize, input]);

  function selectThread(nextId: string) {
    setThreadId(nextId);
    setPendingUserMessage(null);
    if (nextId) window.localStorage.setItem(ACTIVE_THREAD_STORAGE_KEY, nextId);
    else window.localStorage.removeItem(ACTIVE_THREAD_STORAGE_KEY);
  }

  function startNewChat() {
    selectThread("");
    setInput("");
    void mutate({ thread: null, messages: [] }, false);
  }

  async function send() {
    const message = input.trim();
    if (!message || submitting) return;
    const currentThreadId = data?.thread?.id ?? threadId;
    setInput("");
    setSubmitting(true);
    setPendingUserMessage({
      id: `pending-${Date.now()}`,
      threadId: currentThreadId || "draft-agent-thread",
      role: "user",
      content: message,
      metadata: {},
      createdAt: Date.now(),
      toolCalls: [],
    });
    try {
      const result = await apiPost<ChatHistoryResponse>("/api/agent/chat", {
        message,
        threadId: currentThreadId || undefined,
        locale,
      });
      if (result.thread) {
        setThreadId(result.thread.id);
        window.localStorage.setItem(ACTIVE_THREAD_STORAGE_KEY, result.thread.id);
      }
      await mutate({ thread: result.thread, messages: result.messages }, false);
      await mutateThreads();
      await mutateCache((key) => typeof key === "string" && key.startsWith("/api/agent/chat/threads"));
    } finally {
      setSubmitting(false);
      setPendingUserMessage(null);
    }
  }

  return (
    <div className="flex h-full min-h-0">
      {/* History rail */}
      <aside className="hidden w-64 min-w-0 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 md:flex">
        <div className="flex items-center px-3 py-3">
          <button
            type="button"
            onClick={startNewChat}
            className="flex flex-1 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-100"
          >
            <Plus className="size-4" />
            {t("agentNewChat")}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {threads.length === 0 ? (
            <p className="px-2 py-2 text-xs text-zinc-400">{t("agentLoadingHistory")}</p>
          ) : (
            threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                onClick={() => selectThread(thread.id)}
                className={cn(
                  "mb-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition",
                  thread.id === threadId ? "bg-zinc-200/70 text-zinc-900" : "text-zinc-600 hover:bg-zinc-200/50",
                )}
              >
                <MessageSquare className="size-4 shrink-0 text-zinc-400" />
                <span className="truncate">{thread.title || t("agentThreadUntitled")}</span>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Conversation */}
      <section className="flex min-w-0 flex-1 flex-col bg-white">
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {isLoading && renderedMessages.length === 0 ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-400">
              <Loader2 className="size-4 animate-spin" />
              {t("agentLoadingHistory")}
            </div>
          ) : renderedMessages.length === 0 ? (
            <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center gap-3 px-6 text-center">
              <span className="grid size-12 place-items-center rounded-2xl bg-zinc-100 text-zinc-500">
                <MessageSquare className="size-6" />
              </span>
              <p className="text-lg font-semibold text-zinc-800">{t("agentAssistantName")}</p>
              <p className="max-w-md text-sm text-zinc-500">{t("agentEmptyState")}</p>
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
              {renderedMessages.map((message) => {
                if (message.role === "user") {
                  return (
                    <div key={message.id} className="flex justify-end">
                      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-zinc-100 px-4 py-2.5 text-[15px] leading-7 text-zinc-800">
                        {message.content}
                      </div>
                    </div>
                  );
                }
                if (message.role === "system") {
                  return (
                    <div key={message.id} className="text-center text-xs text-zinc-400">
                      {message.content}
                    </div>
                  );
                }
                return <AssistantTurn key={message.id} message={message} />;
              })}
              {submitting ? (
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                  <Loader2 className="size-4 animate-spin" />
                  {t("agentToolRunning")}
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="border-t border-zinc-100 px-4 py-3">
          <div className="mx-auto max-w-3xl">
            <div className="flex items-end gap-2 rounded-3xl border border-zinc-200 bg-white px-3 py-2 shadow-sm focus-within:border-zinc-300">
              <textarea
                ref={textareaRef}
                value={input}
                rows={1}
                placeholder={t("agentChatPlaceholder")}
                disabled={submitting}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                className="max-h-52 min-h-8 flex-1 resize-none border-0 bg-transparent px-1 py-1.5 text-[15px] leading-6 outline-none placeholder:text-zinc-400 disabled:opacity-60"
              />
              <button
                type="button"
                disabled={submitting || !input.trim()}
                onClick={() => void send()}
                aria-label={t("agentSend")}
                title={t("agentSend")}
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-full transition",
                  submitting || !input.trim()
                    ? "cursor-not-allowed bg-zinc-100 text-zinc-400"
                    : "bg-zinc-900 text-white hover:bg-zinc-700",
                )}
              >
                {submitting ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
              </button>
            </div>
            <p className="mt-2 text-center text-xs text-zinc-400">{t("chatDisclaimer")}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
