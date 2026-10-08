export const locales = ["zh-cn", "zh-hk", "en"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "zh-cn";

export function isLocale(value: string | undefined): value is Locale {
  return typeof value === "string" && locales.includes(value as Locale);
}

export function localeLabel(locale: Locale) {
  if (locale === "zh-cn") return "简体中文";
  return locale === "zh-hk" ? "繁體中文 (香港)" : "English";
}

/** Default AI/LLM output language name for a UI locale, used when no explicit language is configured. */
export function localeLanguageName(locale: Locale | undefined): string {
  if (locale === "en") return "English";
  if (locale === "zh-hk") return "Traditional Chinese";
  return "Simplified Chinese";
}

/**
 * BCP-47 tag for a UI locale, used for `Intl` date/time/number formatting.
 * Unknown values are passed through so callers can also pass a raw tag.
 */
export function localeTag(locale: Locale | string | undefined): string {
  if (locale === "zh-cn") return "zh-CN";
  if (locale === "zh-hk") return "zh-HK";
  if (locale === "en") return "en-US";
  return typeof locale === "string" && locale ? locale : "zh-HK";
}

export function stripLocale(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  if (isLocale(segments[0])) {
    return `/${segments.slice(1).join("/")}` || "/";
  }
  return pathname || "/";
}

export function localizedPath(locale: Locale, href: string) {
  if (!href.startsWith("/")) return href;
  const [path, query = ""] = href.split("?");
  const cleanPath = stripLocale(path);
  return `/${locale}${cleanPath === "/" ? "" : cleanPath}${query ? `?${query}` : ""}`;
}
