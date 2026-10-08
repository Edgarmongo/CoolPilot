import type { AccountPlatform } from "@/lib/types";

/**
 * Canonical metric buckets with the per-platform labels that map onto them.
 * Kept data-only (like `publish-profiles.ts`) so a platform's DOM drift is fixed
 * in exactly one place.
 */
export type MetricLabelSet = {
  views: string[];
  likes: string[];
  comments: string[];
  shares: string[];
  favorites: string[];
  /** Video completion rate, when the platform exposes it. */
  completion: string[];
};

export type PlatformMetricProfile = {
  /** Creator-backend page that lists per-content metrics (reads are author-only). */
  statsPageUrl: string;
  /** Text that means the session is no longer logged in. */
  loginTextPatterns: string[];
  labels: MetricLabelSet;
  followerLabels: string[];
  /** Text that means the account genuinely has no content to read. */
  emptyPatterns: string[];
};

const genericLabels: MetricLabelSet = {
  views: ["阅读", "播放", "展现", "浏览"],
  likes: ["赞同", "点赞", "喜欢", "在看"],
  comments: ["评论", "留言"],
  shares: ["分享", "转发", "转载"],
  favorites: ["收藏"],
  completion: ["完播率", "完播"],
};

export const genericMetricProfile: PlatformMetricProfile = {
  statsPageUrl: "",
  loginTextPatterns: ["登录", "登陆", "扫码登录", "log in", "sign in"],
  labels: genericLabels,
  followerLabels: ["粉丝", "关注者", "订阅"],
  emptyPatterns: ["暂无内容", "还没有内容", "暂无数据"],
};

/**
 * Platform overrides. Only 知乎 (the first collection target) is tuned for now;
 * everything else falls back to the generic label set so the pipeline still runs.
 */
export const defaultMetricProfiles: Partial<Record<AccountPlatform, PlatformMetricProfile>> = {
  知乎: {
    statsPageUrl: "https://creator.zhihu.com/creator/manage/creation/all",
    loginTextPatterns: ["登录", "注册", "扫码登录"],
    labels: {
      views: ["阅读"],
      likes: ["赞同", "喜欢"],
      comments: ["评论"],
      shares: ["分享"],
      favorites: ["收藏"],
      completion: [],
    },
    followerLabels: ["关注者", "粉丝"],
    emptyPatterns: ["暂无内容", "还没有内容"],
  },
};

export function getMetricProfile(platform: string): PlatformMetricProfile {
  return defaultMetricProfiles[platform as AccountPlatform] ?? genericMetricProfile;
}
