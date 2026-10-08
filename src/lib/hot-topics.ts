import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import { HOT_TOPICS_ALL, hotTopicPlatforms } from "./hot-topic-platforms";

export type HotTopic = {
  id: string;
  title: string;
  url: string;
  source: string;
  hot?: number;
};

export type { HotTopicPlatform } from "./hot-topic-platforms";
export { HOT_TOPICS_ALL, hotTopicPlatforms };

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

function toId(source: string, index: number, title: string) {
  return `${source}-${index}-${title.slice(0, 24)}`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function fetchHtml(url: string): Promise<cheerio.CheerioAPI> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return cheerio.load(await response.text());
}

function pickText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && "#text" in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>)["#text"] ?? "").trim();
  }
  return "";
}

function pickLink(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    for (const entry of value) {
      const link = pickLink(entry);
      if (link) return link;
    }
    return "";
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return String(record["@_href"] ?? record.href ?? record["#text"] ?? "").trim();
  }
  return "";
}

/** Parses an RSS 2.0 or Atom feed into hot topics. */
async function fetchFeed(url: string, source: string): Promise<HotTopic[]> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml,application/xml,text/xml" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const data = parser.parse(await response.text()) as Record<string, unknown>;
  const rss = data?.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel as Record<string, unknown> | undefined;
  const raw = channel?.item ?? (data?.feed as Record<string, unknown> | undefined)?.entry;
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return items
    .map((item, index) => {
      const entry = item as Record<string, unknown>;
      const title = pickText(entry.title);
      return { id: toId(source, index, title), title, url: pickLink(entry.link) || pickText(entry.id), source };
    })
    .filter((item) => item.title)
    .slice(0, 30);
}

function simpleList(
  entries: Array<{ title: string; url: string; hot?: number }>,
  source: string,
): HotTopic[] {
  return entries
    .filter((entry) => entry.title)
    .slice(0, 30)
    .map((entry, index) => ({ id: toId(source, index, entry.title), source, ...entry }));
}

async function baiduHot() {
  const $ = await fetchHtml("https://top.baidu.com/board?tab=realtime");
  const entries: Array<{ title: string; url: string }> = [];
  $("a .c-single-text-ellipsis").each((_, el) => {
    const title = $(el).text().trim();
    if (title && !entries.some((entry) => entry.title === title)) {
      entries.push({ title, url: $(el).closest("a").attr("href") ?? "" });
    }
  });
  return simpleList(entries, "百度热搜");
}

async function weiboHot() {
  const data = await fetchJson<{ data?: { realtime?: Array<{ word?: string; num?: number }> } }>(
    "https://weibo.com/ajax/side/hotSearch",
    { headers: { Referer: "https://weibo.com/" } },
  );
  return simpleList(
    (data?.data?.realtime ?? []).map((item) => ({
      title: String(item.word ?? "").trim(),
      url: `https://s.weibo.com/weibo?q=${encodeURIComponent(String(item.word ?? ""))}`,
      hot: Number(item.num ?? 0),
    })),
    "微博热搜",
  );
}

async function zhihuHot() {
  const data = await fetchJson<{
    data?: Array<{ target?: { title?: string; url?: string }; detail_text?: number | string }>;
  }>("https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=30&desktop=true");
  return simpleList(
    (data?.data ?? []).map((item) => ({
      title: String(item?.target?.title ?? "").trim(),
      url: String(item?.target?.url ?? "").replace("api.zhihu.com", "www.zhihu.com"),
      hot: Number(item?.detail_text ?? 0),
    })),
    "知乎热榜",
  );
}

async function toutiaoHot() {
  const data = await fetchJson<{ data?: Array<{ Title?: string; Url?: string; HotValue?: number }> }>(
    "https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc",
  );
  return simpleList(
    (data?.data ?? []).map((item) => ({
      title: String(item?.Title ?? "").trim(),
      url: String(item?.Url ?? ""),
      hot: Number(item?.HotValue ?? 0),
    })),
    "今日头条",
  );
}

async function bilibiliHot() {
  const data = await fetchJson<{ data?: { trending?: { list?: Array<{ keyword?: string }> } } }>(
    "https://s.search.bilibili.com/main/hotword?limit=30",
    { headers: { Referer: "https://www.bilibili.com/" } },
  );
  const list = data?.data?.trending?.list ?? [];
  return simpleList(
    list.map((item) => {
      const title = String(item?.keyword ?? "").trim();
      return { title, url: `https://search.bilibili.com/all?keyword=${encodeURIComponent(title)}` };
    }),
    "哔哩哔哩",
  );
}

async function douyinHot() {
  const data = await fetchJson<{ word_list?: Array<{ word?: string; hot_value?: number }> }>(
    "https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/",
  );
  return simpleList(
    (data?.word_list ?? []).map((item) => ({
      title: String(item.word ?? "").trim(),
      url: `https://www.douyin.com/search/${encodeURIComponent(String(item.word ?? ""))}`,
      hot: Number(item.hot_value ?? 0),
    })),
    "抖音热点",
  );
}

async function tencentNewsHot() {
  const data = await fetchJson<{
    idlist?: Array<{ newslist?: Array<{ title?: string; id?: string }> }>;
  }>("https://r.inews.qq.com/gw/event/hot_ranking_list?page_size=30");
  const list = data?.idlist?.[0]?.newslist ?? [];
  return simpleList(
    list.map((item) => ({
      title: String(item.title ?? "").trim(),
      url: item.id ? `https://new.qq.com/rain/a/${item.id}` : "",
    })),
    "腾讯新闻",
  );
}

async function csdnHot() {
  const data = await fetchJson<{
    data?: Array<{ articleTitle?: string; articleDetailUrl?: string; hotRankScore?: number }>;
  }>("https://blog.csdn.net/phoenix/web/blog/hot-rank?page=0&pageSize=30");
  return simpleList(
    (data?.data ?? []).map((item) => ({
      title: String(item.articleTitle ?? "").trim(),
      url: String(item.articleDetailUrl ?? ""),
      hot: Number(item.hotRankScore ?? 0),
    })),
    "CSDN",
  );
}

async function acfunHot() {
  const data = await fetchJson<{ rankList?: Array<{ contentTitle?: string; contentId?: number }> }>(
    "https://www.acfun.cn/rest/pc-direct/rank/channel?channelId=&rankLimit=30&rankPeriod=DAY",
    { headers: { Referer: "https://www.acfun.cn/" } },
  );
  return simpleList(
    (data?.rankList ?? []).map((item) => ({
      title: String(item.contentTitle ?? "").trim(),
      url: item.contentId ? `https://www.acfun.cn/v/ac${item.contentId}` : "",
    })),
    "AcFun",
  );
}

async function githubTrending() {
  const $ = await fetchHtml("https://github.com/trending?since=daily");
  const entries: Array<{ title: string; url: string }> = [];
  $("article.Box-row h2 a").each((_, el) => {
    const title = $(el).text().replace(/\s+/g, " ").trim();
    if (title) entries.push({ title, url: `https://github.com${$(el).attr("href") ?? ""}` });
  });
  return simpleList(entries, "GitHub Trending");
}

async function sspaiHot() {
  const data = await fetchJson<{ data?: Array<{ title?: string; id?: number | string }> }>(
    "https://sspai.com/api/v1/article/index/page/get?limit=20&offset=0",
  );
  return simpleList(
    (data?.data ?? []).map((item) => ({
      title: String(item.title ?? "").trim(),
      url: item.id ? `https://sspai.com/post/${item.id}` : "",
    })),
    "少数派",
  );
}

async function thepaperHot() {
  const data = await fetchJson<{ data?: { hotNews?: Array<{ name?: string; contId?: string }> } }>(
    "https://cache.thepaper.cn/contentapi/wwwIndex/rightSidebar",
  );
  return simpleList(
    (data?.data?.hotNews ?? []).map((item) => ({
      title: String(item.name ?? "").trim(),
      url: item.contId ? `https://www.thepaper.cn/newsDetail_forward_${item.contId}` : "",
    })),
    "澎湃新闻",
  );
}

async function ithomeHot() {
  const $ = await fetchHtml("https://www.ithome.com/0/0/1/");
  const entries: Array<{ title: string; url: string }> = [];
  $(".lst li a.t").each((_, el) => {
    const title = $(el).text().trim();
    if (title) entries.push({ title, url: $(el).attr("href") ?? "" });
  });
  return simpleList(entries, "IT之家");
}

async function todayHistory() {
  const data = await fetchJson<{ list?: unknown[]; result?: unknown[] }>("https://api.oick.cn/lishi/api.php");
  const list = data?.result ?? data?.list ?? [];
  return simpleList(
    list.map((entry) => {
      if (typeof entry === "string") return { title: entry.trim(), url: "" };
      const record = entry as { title?: string };
      return { title: String(record.title ?? "").trim(), url: "" };
    }),
    "历史上的今天",
  );
}

function feedFetcher(url: string, source: string) {
  return () => fetchFeed(url, source);
}

const hotTopicFetchers: Record<string, () => Promise<HotTopic[]>> = {
  "baidu-hot": baiduHot,
  "weibo-hot": weiboHot,
  "toutiao-hot": toutiaoHot,
  "douyin-hot": douyinHot,
  "zhihu-hot": zhihuHot,
  "bilibili-hot": bilibiliHot,
  "tencent-news": tencentNewsHot,
  csdn: csdnHot,
  acfun: acfunHot,
  "github-trending": githubTrending,
  sspai: sspaiHot,
  thepaper: thepaperHot,
  ithome: ithomeHot,
  "today-history": todayHistory,
  ifanr: feedFetcher("https://www.ifanr.com/feed", "爱范儿"),
  "the-verge": feedFetcher("https://www.theverge.com/rss/index.xml", "The Verge"),
  "9to5mac": feedFetcher("https://9to5mac.com/feed/", "9to5Mac"),
  people: feedFetcher("http://www.people.com.cn/rss/politics.xml", "人民网"),
};

const MAX_HOT_TOPICS = 140;

/**
 * Aggregates hot topics for a platform chip (or every available source when
 * `platformId` is `HOT_TOPICS_ALL`). Individual source failures degrade to an
 * empty list so one blocked platform never breaks the whole panel.
 */
export async function fetchHotTopics(platformId: string = HOT_TOPICS_ALL, query = ""): Promise<HotTopic[]> {
  const targets =
    platformId === HOT_TOPICS_ALL
      ? hotTopicPlatforms.filter((platform) => platform.available)
      : hotTopicPlatforms.filter((platform) => platform.id === platformId && platform.available);

  const batches = await Promise.all(
    targets.map(async (platform) => {
      const fetcher = hotTopicFetchers[platform.id];
      if (!fetcher) return [] as HotTopic[];
      try {
        return await fetcher();
      } catch {
        return [] as HotTopic[];
      }
    }),
  );

  const keyword = query.trim().toLowerCase();
  const seen = new Set<string>();
  const merged: HotTopic[] = [];
  for (const item of batches.flat()) {
    if (!item.title || seen.has(item.title)) continue;
    if (keyword && !item.title.toLowerCase().includes(keyword)) continue;
    seen.add(item.title);
    merged.push(item);
    if (merged.length >= MAX_HOT_TOPICS) break;
  }
  return merged;
}
