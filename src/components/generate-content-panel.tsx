"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Flame, Sparkles } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { articleEditorHref } from "@/lib/editor-link";
import { Button } from "@/components/ui/button";
import { consoleInputClass } from "@/components/ui/console-surface";
import { writingAgents } from "@/lib/writing-agents";
import { GenerationSourceSelects } from "@/components/creation/generation-source-selects";

type GeneratedPayload = {
  item: { id: string; title: string; body: string; postReadyText: string };
  provider?: string;
  model?: string;
};

type HotTopic = { title: string; url: string; source: string; hot?: number };

export function GenerateContentPanel({
  type,
  onGenerated,
}: {
  type: string;
  onGenerated?: () => void;
}) {
  const { t, locale } = useI18n();
  const [agentId, setAgentId] = useState("general");
  const [topic, setTopic] = useState("");
  const [topicId, setTopicId] = useState("");
  const [brandId, setBrandId] = useState("");
  /** 研究素材 (CI-P3-01): the third stored row the route reads for this run. */
  const [researchMaterialId, setResearchMaterialId] = useState("");
  const [keywords, setKeywords] = useState("");
  const [maxWords, setMaxWords] = useState(300);
  const [language, setLanguage] = useState("简体中文");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GeneratedPayload | null>(null);
  const [error, setError] = useState("");
  const [hotKeyword, setHotKeyword] = useState("");
  const [hotLoading, setHotLoading] = useState(false);
  const [hotTopics, setHotTopics] = useState<HotTopic[]>([]);

  async function handleGenerate() {
    if (!topic.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const data = await apiPost<GeneratedPayload>("/api/content/generate", {
        topic: topic.trim(),
        keywords,
        maxWords,
        language,
        prompt,
        type,
        agentId,
        // 选题 and 品牌资料 are read from the stored rows by the route (CI-P2-03); the ids are all this
        // panel sends, so what reaches the prompt is the row and not a client-side copy of it.
        topicId,
        brandId,
        // 研究素材 (CI-P3-01): the third stored row this route reads, on the same terms - the id travels,
        // the route loads the material's own text.
        researchMaterialId,
      });
      setResult(data);
      onGenerated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleLoadHot() {
    setHotLoading(true);
    setError("");
    try {
      const data = await apiGet<{ items: HotTopic[] }>("/api/hot-topics");
      setHotTopics(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setHotLoading(false);
    }
  }

  useEffect(() => {
    window.queueMicrotask(() => void handleLoadHot());
  }, []);

  return (
    <div className="space-y-4">
      <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
        <span>{t("appStoreAgents")}</span>
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className={consoleInputClass}>
          {writingAgents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.emoji} {agent.name} · {agent.description}
            </option>
          ))}
        </select>
      </label>

      {/* 选题库 / 品牌资料 / 研究素材 (CI-P2-03, CI-P3-01): what this run reads besides the agent and the typed topic. */}
      <GenerationSourceSelects
        topicId={topicId}
        brandId={brandId}
        researchMaterialId={researchMaterialId}
        onChange={(patch) => {
          if (patch.topicId !== undefined) {
            setTopicId(patch.topicId);
            // The stored topic prefills the subject the user sees; its other fields are read by the route.
            if (patch.topic) setTopic(patch.topic.title);
          }
          if (patch.brandId !== undefined) setBrandId(patch.brandId);
          if (patch.researchMaterialId !== undefined) setResearchMaterialId(patch.researchMaterialId);
        }}
      />

      <div className="rounded-2xl border border-sky-100 bg-sky-50/40 p-3">
        <div className="flex gap-2">
          <input
            value={hotKeyword}
            onChange={(e) => setHotKeyword(e.target.value)}
            placeholder={t("hotSearchPlaceholder")}
            className={consoleInputClass}
          />
          <Button variant="outline" size="sm" onClick={() => void handleLoadHot()} loading={hotLoading}>
            <Flame size={14} />
            {t("hotSearch")}
          </Button>
        </div>
        {hotTopics.length > 0 ? (
          <div className="mt-3 max-h-48 space-y-1.5 overflow-y-auto">
            {hotTopics
              .filter((item) => !hotKeyword.trim() || item.title.includes(hotKeyword.trim()))
              .map((item) => (
                <button
                  key={`${item.source}-${item.title}`}
                  type="button"
                  onClick={() => setTopic(item.title)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-sky-100"
                >
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-700">{item.source}</span>
                </button>
              ))}
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium text-zinc-700 md:col-span-2">
          <span>{t("genTopic")}</span>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={t("genTopic")}
            className={consoleInputClass}
          />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-zinc-700 md:col-span-2">
          <span>{t("genKeywords")}</span>
          <input value={keywords} onChange={(e) => setKeywords(e.target.value)} className={consoleInputClass} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
          <span>{t("genMaxWords")}</span>
          <input
            type="number"
            min={50}
            max={1000}
            value={maxWords}
            onChange={(e) => setMaxWords(Number(e.target.value) || 300)}
            className={consoleInputClass}
          />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
          <span>{t("genLanguage")}</span>
          <input value={language} onChange={(e) => setLanguage(e.target.value)} className={consoleInputClass} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-zinc-700 md:col-span-2">
          <span>{t("genPrompt")}</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className={`${consoleInputClass} min-h-20 resize-none`}
          />
        </label>
      </div>

      <Button onClick={handleGenerate} loading={loading} disabled={!topic.trim()}>
        <Sparkles size={16} />
        {loading ? t("genGenerating") : t("genGenerate")}
      </Button>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      {result ? (
        <div className="space-y-3 rounded-2xl border border-sky-100 bg-sky-50/40 p-4">
          <p className="text-xs font-medium text-sky-700">
            {t("genSaved")}
            {result.provider ? ` · ${result.provider}${result.model ? ` / ${result.model}` : ""}` : ""}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-zinc-900">{result.item.title}</h3>
            {/* The hand-off into the existing article editor (P5-C1): what was just generated is what the
                workspace opens with `?edit=<id>`, which is also where 配图 / 封面 / 发布 continue. */}
            <Link
              href={articleEditorHref(locale, result.item.id)}
              className="text-xs font-medium text-sky-600 hover:underline"
            >
              {t("awOpenEditor")}
            </Link>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-700">{result.item.body}</p>
          {result.item.postReadyText ? (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-zinc-400">{t("genResult")}</p>
              <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-700">{result.item.postReadyText}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
