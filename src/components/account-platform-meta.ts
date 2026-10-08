import type { AccountPlatform } from "@/lib/types";

export type PlatformMeta = {
  /** Short glyph rendered inside the platform avatar (1-2 characters). */
  glyph: string;
  /** Tailwind background class used for the platform avatar. */
  colorClass: string;
  /** Extra searchable keywords (aliases, pinyin, English names). */
  aliases?: string[];
};

/**
 * Presentation metadata for the account platform picker and account cards.
 * There are no brand image assets in this repo, so each platform is rendered as a
 * colored rounded tile with a short glyph (mirroring the reference console look).
 */
export const platformMeta: Record<AccountPlatform, PlatformMeta> = {
  头条号: { glyph: "头", colorClass: "bg-red-500", aliases: ["toutiao", "头条"] },
  百家号: { glyph: "百", colorClass: "bg-blue-500", aliases: ["baijiahao", "baidu", "百家"] },
  微信公众号: { glyph: "微", colorClass: "bg-emerald-500", aliases: ["weixin", "wechat", "mp"] },
  抖音: { glyph: "抖", colorClass: "bg-zinc-900", aliases: ["douyin", "tiktok cn"] },
  小红书: { glyph: "红", colorClass: "bg-rose-500", aliases: ["xiaohongshu", "red", "rednote"] },
  知乎: { glyph: "知", colorClass: "bg-sky-500", aliases: ["zhihu"] },
  哔哩哔哩: { glyph: "B", colorClass: "bg-pink-500", aliases: ["bilibili", "b站", "bili"] },
  微博: { glyph: "微", colorClass: "bg-orange-500", aliases: ["weibo"] },
  企鹅号: { glyph: "企", colorClass: "bg-blue-600", aliases: ["qie", "qq", "om"] },
  快手: { glyph: "快", colorClass: "bg-orange-600", aliases: ["kuaishou", "kwai"] },
  视频号: { glyph: "视", colorClass: "bg-green-500", aliases: ["channels", "weixin video"] },
  淘宝光合: { glyph: "淘", colorClass: "bg-amber-500", aliases: ["taobao", "guanghe"] },
  搜狐号: { glyph: "搜", colorClass: "bg-slate-600", aliases: ["sohu"] },
  大鱼号: { glyph: "大", colorClass: "bg-cyan-600", aliases: ["dayu", "uc"] },
  快传号: { glyph: "快", colorClass: "bg-red-600", aliases: ["kuaichuan", "360"] },
  豆瓣: { glyph: "豆", colorClass: "bg-green-600", aliases: ["douban"] },
  CSDN: { glyph: "C", colorClass: "bg-red-500", aliases: ["csdn", "blog"] },
  简书: { glyph: "简", colorClass: "bg-orange-500", aliases: ["jianshu"] },
  Threads: { glyph: "T", colorClass: "bg-zinc-900", aliases: ["threads", "meta"] },
  Facebook: { glyph: "f", colorClass: "bg-blue-600", aliases: ["facebook", "meta", "fb"] },
  Instagram: { glyph: "I", colorClass: "bg-fuchsia-500", aliases: ["instagram", "ig", "meta"] },
  LinkedIn: { glyph: "in", colorClass: "bg-sky-700", aliases: ["linkedin"] },
  YouTube: { glyph: "Y", colorClass: "bg-red-600", aliases: ["youtube", "yt", "google"] },
  TikTok: { glyph: "T", colorClass: "bg-zinc-900", aliases: ["tiktok", "douyin"] },
  WordPress: { glyph: "W", colorClass: "bg-slate-700", aliases: ["wordpress", "wp", "blog"] },
  InnoShop: { glyph: "I", colorClass: "bg-indigo-500", aliases: ["innoshop", "shop"] },
  PbootCMS: { glyph: "P", colorClass: "bg-teal-600", aliases: ["pbootcms", "cms"] },
  Other: { glyph: "＋", colorClass: "bg-zinc-500", aliases: ["other", "自定义", "custom"] },
};

/** Platforms offered by the \"add account\" flow (the generic bucket is excluded). */
export const accountPlatformOptions: AccountPlatform[] = (Object.keys(platformMeta) as AccountPlatform[]).filter(
  (platform) => platform !== "Other",
);

/**
 * Platforms that are connected as websites (CMS) rather than social accounts.
 * These drive the \"connect CMS site\" dialog.
 */
export const cmsPlatformOptions: AccountPlatform[] = ["InnoShop", "PbootCMS", "WordPress", "Other"];

/** Daily CMS write allowance mirrored by the reference console (per account). */
export const CMS_DAILY_WRITE_QUOTA = 5;

export function isCmsPlatform(platform: string): boolean {
  return (cmsPlatformOptions as string[]).includes(platform);
}

export function platformMatchesSearch(platform: AccountPlatform, keyword: string) {
  const trimmed = keyword.trim().toLowerCase();
  if (!trimmed) return true;
  if (platform.toLowerCase().includes(trimmed)) return true;
  const meta = platformMeta[platform];
  return Boolean(meta.aliases?.some((alias) => alias.toLowerCase().includes(trimmed)));
}
