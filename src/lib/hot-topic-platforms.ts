/**
 * Client-safe catalogue of the "Hot news" source chips.
 *
 * Kept separate from `hot-topics.ts` so the browser bundle never pulls in the
 * server-only scraping dependencies (cheerio / fast-xml-parser).
 */
export type HotTopicPlatform = {
  id: string;
  label: string;
  /** False when the console has no working adapter for this source yet. */
  available: boolean;
};

export const HOT_TOPICS_ALL = "all";

export const hotTopicPlatforms: HotTopicPlatform[] = [
  { id: "baidu-hot", label: "百度热搜", available: true },
  { id: "weibo-hot", label: "微博热搜", available: true },
  { id: "toutiao-hot", label: "今日头条", available: true },
  { id: "douyin-hot", label: "抖音热点", available: true },
  { id: "zhihu-hot", label: "知乎热榜", available: true },
  { id: "bilibili-hot", label: "哔哩哔哩", available: true },
  { id: "hupu", label: "虎扑", available: false },
  { id: "ithome", label: "IT之家", available: true },
  { id: "acfun", label: "AcFun", available: true },
  { id: "csdn", label: "CSDN", available: true },
  { id: "twitter-trends", label: "推特趋势", available: false },
  { id: "github-trending", label: "GitHub Trending", available: true },
  { id: "sspai", label: "少数派", available: true },
  { id: "thepaper", label: "澎湃新闻", available: true },
  { id: "quark", label: "夸克", available: false },
  { id: "huxiu", label: "虎嗅", available: false },
  { id: "nanfang", label: "南方周末", available: false },
  { id: "cctv", label: "CCTV News", available: false },
  { id: "litchi", label: "梨视频", available: false },
  { id: "natgeo", label: "国家地理", available: false },
  { id: "tencent-news", label: "腾讯新闻", available: true },
  { id: "netease", label: "网易新闻", available: false },
  { id: "sina", label: "新浪新闻", available: false },
  { id: "today-history", label: "历史上的今天", available: true },
  { id: "so-360", label: "360热搜", available: false },
  { id: "ifanr", label: "爱范儿", available: true },
  { id: "infoq", label: "InfoQ", available: false },
  { id: "gcores", label: "机核网", available: false },
  { id: "weread", label: "微信读书", available: false },
  { id: "the-verge", label: "The Verge", available: true },
  { id: "9to5mac", label: "9to5Mac", available: true },
  { id: "people", label: "人民网", available: true },
];
