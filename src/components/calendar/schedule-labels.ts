import { formatRunTime } from "@/lib/schedule";
import type { TranslationKey } from "@/lib/locale-resources";
import type { PlaybookId, ScheduleTime } from "@/lib/types";

export type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;

/** 0 = Sunday … 6 = Saturday, matching `Date#getDay()`. */
export const weekdayLabelKeys: TranslationKey[] = [
  "metricsWeekdaySun",
  "metricsWeekdayMon",
  "metricsWeekdayTue",
  "metricsWeekdayWed",
  "metricsWeekdayThu",
  "metricsWeekdayFri",
  "metricsWeekdaySat",
];

export const playbookLabelKeys: Record<PlaybookId, TranslationKey> = {
  topic_article_generator: "playbookTopicArticleGenerator",
  ai_prompt_proxy: "playbookAiPromptProxy",
  article_scraper_rewriter: "playbookArticleScraperRewriter",
  ai_url_extractor: "playbookAiUrlExtractor",
  topic_search_writer: "playbookTopicSearchWriter",
  threads_auto_post: "playbookThreadsAutoPost",
  threads_compose_post: "playbookThreadsComposePost",
};

export const scheduleTimeTypeLabelKeys: Record<ScheduleTime["type"], TranslationKey> = {
  once: "scheduleTypeOnce",
  daily: "scheduleTypeDaily",
  weekly: "scheduleTypeWeekly",
  monthly: "scheduleTypeMonthly",
  interval: "scheduleTypeInterval",
};

export function playbookLabel(playbookId: string | undefined, t: Translate) {
  if (!playbookId) return "";
  const key = playbookLabelKeys[playbookId as PlaybookId];
  return key ? t(key) : playbookId;
}

export function weekdayLabel(weekday: number, t: Translate) {
  return t(weekdayLabelKeys[weekday] ?? "metricsWeekdaySun");
}

function joinList(values: string[], locale: string) {
  return values.join(locale.startsWith("zh") ? "、" : ", ");
}

/** Human label for a single recurrence rule, e.g. `每週 週一、週三 09:00`. */
export function scheduleTimeLabel(entry: ScheduleTime, t: Translate, locale: string): string {
  switch (entry.type) {
    case "once": {
      const at = Date.parse(entry.at);
      return Number.isFinite(at)
        ? t("scheduleOnceLabel", { time: formatRunTime(at, locale) })
        : t(scheduleTimeTypeLabelKeys.once);
    }
    case "weekly":
      return t("scheduleWeeklyLabel", {
        days: joinList(entry.weekdays.map((day) => weekdayLabel(day, t)), locale),
        time: entry.time,
      });
    case "monthly":
      return t("scheduleMonthlyLabel", {
        days: joinList(entry.days.map((day) => String(day)), locale),
        time: entry.time,
      });
    case "interval":
      return entry.everyMinutes >= 60 && entry.everyMinutes % 60 === 0
        ? t("scheduleEveryHours", { hours: entry.everyMinutes / 60 })
        : t("scheduleEveryMinutes", { minutes: entry.everyMinutes });
    default:
      return t("scheduleDailyLabel", { time: entry.time });
  }
}

export function scheduleTimesLabel(scheduleTimes: ScheduleTime[], t: Translate, locale: string): string {
  if (scheduleTimes.length === 0) return t("scheduleTimesEmpty");
  return joinList(scheduleTimes.map((entry) => scheduleTimeLabel(entry, t, locale)), locale);
}
