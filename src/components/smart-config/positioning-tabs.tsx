"use client";

import { useState } from "react";
import useSWR from "swr";
import { ChevronDown, ChevronRight, Inbox } from "lucide-react";
import { accountPlatformOptions } from "@/components/account-platform-meta";
import { consoleInputClass } from "@/components/ui/console-surface";
import { swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import {
  positionFieldLimits,
  positionStyleLabelKeys,
  positionToneLabelKeys,
  type PositionTabId,
} from "@/lib/positions";
import { positionStyles, positionTones, type PositionDraft, type PositionStyle, type PositionTone, type AccountRecord } from "@/lib/types";
import { Counter, Field, NoticeBanner, RangeField, TagInput, Toggle } from "./positioning-fields";

type Patch = Partial<PositionDraft>;

type TabProps = {
  draft: PositionDraft;
  onChange: (patch: Patch) => void;
  positionId: string;
};

function BasicTab({ draft, onChange }: TabProps) {
  const { t } = useI18n();
  return (
    <div className="grid gap-5">
      <Field label={t("posFieldName")}>
        <input
          value={draft.name}
          maxLength={positionFieldLimits.name}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder={t("posNamePlaceholder")}
          className={consoleInputClass}
        />
      </Field>
      <Field label={t("posFieldDescription")} counter={<Counter value={draft.description.length} max={positionFieldLimits.description} />}>
        <textarea
          value={draft.description}
          maxLength={positionFieldLimits.description}
          onChange={(event) => onChange({ description: event.target.value })}
          placeholder={t("posFieldDescriptionPlaceholder")}
          className={`${consoleInputClass} min-h-28 resize-none`}
        />
      </Field>
      <Field label={t("posFieldAudience")}>
        <input
          value={draft.targetAudience}
          maxLength={positionFieldLimits.targetAudience}
          onChange={(event) => onChange({ targetAudience: event.target.value })}
          placeholder={t("posFieldAudiencePlaceholder")}
          className={consoleInputClass}
        />
      </Field>
      <Field label={t("posFieldDirection")}>
        <input
          value={draft.contentDirection}
          maxLength={positionFieldLimits.contentDirection}
          onChange={(event) => onChange({ contentDirection: event.target.value })}
          placeholder={t("posFieldDirectionPlaceholder")}
          className={consoleInputClass}
        />
      </Field>
      <Field label={t("posFieldTone")} counter={<Counter value={draft.toneStyle.length} max={positionFieldLimits.toneStyle} />}>
        <textarea
          value={draft.toneStyle}
          maxLength={positionFieldLimits.toneStyle}
          onChange={(event) => onChange({ toneStyle: event.target.value })}
          placeholder={t("posFieldTonePlaceholder")}
          className={`${consoleInputClass} min-h-24 resize-none`}
        />
      </Field>
    </div>
  );
}

function PersonaTab({ draft, onChange }: TabProps) {
  const { t } = useI18n();
  return (
    <div className="grid gap-5">
      <NoticeBanner title={t("posPersonaUpgradeTitle")}>{t("posPersonaUpgradeDesc")}</NoticeBanner>
      <Field label={t("posFieldPersonaRole")} counter={<Counter value={draft.personaRole.length} max={positionFieldLimits.personaRole} />}>
        <textarea
          value={draft.personaRole}
          maxLength={positionFieldLimits.personaRole}
          onChange={(event) => onChange({ personaRole: event.target.value })}
          placeholder={t("posFieldPersonaRolePlaceholder")}
          className={`${consoleInputClass} min-h-48 resize-none`}
        />
      </Field>
      <Field label={t("posFieldPersonaSeeds")} counter={<Counter value={draft.personaSeeds.length} max={positionFieldLimits.personaSeeds} />}>
        <textarea
          value={draft.personaSeeds}
          maxLength={positionFieldLimits.personaSeeds}
          onChange={(event) => onChange({ personaSeeds: event.target.value })}
          placeholder={t("posFieldPersonaSeedsPlaceholder")}
          className={`${consoleInputClass} min-h-40 resize-none`}
        />
        <span className="text-xs leading-5 text-zinc-400">{t("posFieldPersonaSeedsHint")}</span>
      </Field>
    </div>
  );
}

function WritingTab({ draft, onChange }: TabProps) {
  const { t } = useI18n();
  return (
    <div className="grid gap-5">
      <Field label={t("posFieldWritingGuide")} counter={<Counter value={draft.writingGuide.length} max={positionFieldLimits.writingGuide} />}>
        <textarea
          value={draft.writingGuide}
          maxLength={positionFieldLimits.writingGuide}
          onChange={(event) => onChange({ writingGuide: event.target.value })}
          placeholder={t("posFieldWritingGuidePlaceholder")}
          className={`${consoleInputClass} min-h-36 resize-none font-mono text-xs leading-6`}
        />
      </Field>
      <div className="grid gap-2">
        <span className="text-sm font-medium text-zinc-700">{t("posFieldBannedWords")}</span>
        <TagInput
          values={draft.bannedWords}
          onChange={(bannedWords) => onChange({ bannedWords })}
          placeholder={t("posFieldBannedWordsPlaceholder")}
          addLabel={t("posAdd")}
          removeLabel={t("posRemove")}
        />
      </div>
      <div className="grid gap-2">
        <span className="text-sm font-medium text-zinc-700">{t("posFieldAntiAi")}</span>
        <Toggle
          checked={draft.antiAiDetection}
          onChange={(antiAiDetection) => onChange({ antiAiDetection })}
          onLabel={t("posToggleOn")}
          offLabel={t("posToggleOff")}
        />
      </div>
    </div>
  );
}

function StrategyTab({ draft, onChange }: TabProps) {
  const { t } = useI18n();
  return (
    <div className="grid gap-7">
      <RangeField
        label={t("posStrategyPreference")}
        value={draft.knowledgeHotspotBalance}
        onChange={(knowledgeHotspotBalance) => onChange({ knowledgeHotspotBalance })}
        leftLabel={t("posStrategyPreferenceLow")}
        midLabel={t("posStrategyPreferenceMid")}
        rightLabel={t("posStrategyPreferenceHigh")}
        hint={t("posStrategyPreferenceHint")}
      />
      <RangeField
        label={t("posStrategyFreedom")}
        value={draft.aiFreedom}
        onChange={(aiFreedom) => onChange({ aiFreedom })}
        leftLabel={t("posStrategyFreedomLow")}
        midLabel={t("posStrategyFreedomMid")}
        rightLabel={t("posStrategyFreedomHigh")}
        hint={t("posStrategyFreedomHint")}
      />
      <div className="border-t border-sky-50 pt-5">
        <div className="grid gap-2">
          <span className="text-sm font-medium text-zinc-700">{t("posStrategyKbReuse")}</span>
          <Toggle
            checked={draft.allowKnowledgeReuse}
            onChange={(allowKnowledgeReuse) => onChange({ allowKnowledgeReuse })}
            onLabel={t("posAllow")}
            offLabel={t("posForbid")}
          />
          <span className="text-xs text-zinc-400">{t("posStrategyKbReuseHint")}</span>
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t("posStrategyCooldown")}>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={365}
              value={draft.cooldownDays}
              onChange={(event) => onChange({ cooldownDays: Math.max(0, Math.min(365, Number(event.target.value) || 0)) })}
              className={consoleInputClass}
            />
            <span className="shrink-0 text-sm text-zinc-500">{t("posUnitDays")}</span>
          </div>
        </Field>
        <Field label={t("posStrategyMaxUses")}>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={9999}
              value={draft.maxUses}
              onChange={(event) => onChange({ maxUses: Math.max(0, Math.min(9999, Number(event.target.value) || 0)) })}
              className={consoleInputClass}
            />
            <span className="shrink-0 text-sm text-zinc-500">{t("posUnitTimes")}</span>
          </div>
        </Field>
      </div>
    </div>
  );
}

function PlatformTab({ draft, onChange }: TabProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toneOptions: Array<{ value: PositionTone | ""; label: string }> = [
    { value: "", label: t("posPlatformGlobal") },
    ...positionTones.map((tone) => ({ value: tone as PositionTone | "", label: t(positionToneLabelKeys[tone]) })),
  ];
  const styleOptions: Array<{ value: PositionStyle | ""; label: string }> = [
    { value: "", label: t("posPlatformDefault") },
    ...positionStyles.map((style) => ({ value: style as PositionStyle | "", label: t(positionStyleLabelKeys[style]) })),
  ];

  function updateOverride(platform: string, patch: Partial<PositionDraft["platformOverrides"][number]>) {
    const existing = draft.platformOverrides.find((entry) => entry.platform === platform);
    const next = {
      platform,
      tone: "",
      wordCount: "",
      style: "",
      topicAngle: "",
      ...(existing ?? {}),
      ...patch,
    } as PositionDraft["platformOverrides"][number];
    const others = draft.platformOverrides.filter((entry) => entry.platform !== platform);
    const isEmpty = !next.tone && !next.style && !next.wordCount && !next.topicAngle;
    onChange({ platformOverrides: isEmpty ? others : [...others, next] });
  }

  return (
    <div className="grid gap-4">
      <NoticeBanner title={t("posPlatformHintTitle")}>{t("posPlatformHintDesc")}</NoticeBanner>
      <div className="divide-y divide-sky-50 overflow-hidden rounded-2xl border border-sky-100">
        {accountPlatformOptions.map((platform) => {
          const override = draft.platformOverrides.find((entry) => entry.platform === platform);
          const isOpen = expanded[platform] ?? false;
          return (
            <div key={platform}>
              <button
                type="button"
                onClick={() => setExpanded((prev) => ({ ...prev, [platform]: !isOpen }))}
                className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-zinc-800 transition hover:bg-sky-50/60"
              >
                {isOpen ? <ChevronDown className="size-4 text-zinc-400" /> : <ChevronRight className="size-4 text-zinc-400" />}
                <span>{platform}</span>
                {override ? <span className="ml-1 size-1.5 rounded-full bg-sky-500" aria-hidden /> : null}
              </button>
              {isOpen ? (
                <div className="grid gap-4 bg-sky-50/40 px-4 pb-5 pt-2">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label={t("posPlatformTone")}>
                      <select
                        value={override?.tone ?? ""}
                        onChange={(event) => updateOverride(platform, { tone: event.target.value as PositionTone | "" })}
                        className={consoleInputClass}
                      >
                        {toneOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={t("posPlatformWords")}>
                      <input
                        value={override?.wordCount ?? ""}
                        inputMode="numeric"
                        onChange={(event) => updateOverride(platform, { wordCount: event.target.value.replace(/[^\d]/g, "") })}
                        placeholder={t("posPlatformDefault")}
                        className={consoleInputClass}
                      />
                    </Field>
                    <Field label={t("posPlatformStyle")}>
                      <select
                        value={override?.style ?? ""}
                        onChange={(event) => updateOverride(platform, { style: event.target.value as PositionStyle | "" })}
                        className={consoleInputClass}
                      >
                        {styleOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field label={t("posPlatformAngle")}>
                    <textarea
                      value={override?.topicAngle ?? ""}
                      maxLength={positionFieldLimits.topicAngle}
                      onChange={(event) => updateOverride(platform, { topicAngle: event.target.value })}
                      placeholder={t("posPlatformAnglePlaceholder")}
                      className={`${consoleInputClass} min-h-20 resize-none`}
                    />
                  </Field>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RssTab({ draft, onChange }: TabProps) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <NoticeBanner title={t("posRssHintTitle")}>{t("posRssHintDesc")}</NoticeBanner>
      <div className="grid gap-2">
        <span className="text-sm font-medium text-zinc-700">{t("posRssLabel")}</span>
        <TagInput
          values={draft.rssSources}
          onChange={(rssSources) => onChange({ rssSources })}
          placeholder={t("posRssPlaceholder")}
          addLabel={t("posAdd")}
          removeLabel={t("posRemove")}
        />
      </div>
    </div>
  );
}

function BindingTab({ positionId }: TabProps) {
  const { t } = useI18n();
  const { data: accounts = [] } = useSWR<AccountRecord[]>("/api/accounts", swrFetcher);
  const bound = accounts.filter((site) => String(site.preset?.positionId ?? "") === positionId);

  if (!bound.length) {
    return (
      <div className="grid place-items-center gap-3 rounded-2xl border border-dashed border-sky-100 bg-sky-50/40 py-16 text-center">
        <Inbox className="size-10 text-zinc-300" />
        <p className="max-w-md text-sm leading-6 text-zinc-500">{t("posBindingEmpty")}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {bound.map((site) => (
        <div key={site.id} className="rounded-2xl border border-sky-100 bg-white p-4">
          <p className="font-medium text-zinc-900">{site.name}</p>
          <p className="mt-1 text-xs text-zinc-400">
            {site.platform} · {site.account || t("posBindingNoAccount")}
          </p>
        </div>
      ))}
    </div>
  );
}

export function PositioningTabPanel({ tab, draft, onChange, positionId }: { tab: PositionTabId } & TabProps) {
  if (tab === "persona") return <PersonaTab draft={draft} onChange={onChange} positionId={positionId} />;
  if (tab === "writing") return <WritingTab draft={draft} onChange={onChange} positionId={positionId} />;
  if (tab === "strategy") return <StrategyTab draft={draft} onChange={onChange} positionId={positionId} />;
  if (tab === "platform") return <PlatformTab draft={draft} onChange={onChange} positionId={positionId} />;
  if (tab === "rss") return <RssTab draft={draft} onChange={onChange} positionId={positionId} />;
  if (tab === "binding") return <BindingTab draft={draft} onChange={onChange} positionId={positionId} />;
  return <BasicTab draft={draft} onChange={onChange} positionId={positionId} />;
}
