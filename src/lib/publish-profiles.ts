import type { AccountPlatform } from "@/lib/types";

export type PlatformPublishProfile = {
  publishPageUrl: string;
  newPostSelectors: string[];
  titleSelectors: string[];
  contentSelectors: string[];
  imageInputSelectors: string[];
  /** Tabs/switches that reveal the video uploader (e.g. 上传视频 / 视频). */
  videoTabSelectors: string[];
  /** File inputs that accept a video; falls back to imageInputSelectors. */
  videoInputSelectors: string[];
  /** How long to wait for the platform to process an uploaded video. */
  videoUploadWaitMs: number;
  publishButtonSelectors: string[];
  confirmButtonSelectors: string[];
  loginTextPatterns: string[];
};

export const genericProfile: PlatformPublishProfile = {
  publishPageUrl: "",
  newPostSelectors: [
    'text="发布"',
    'text="发布笔记"',
    'text="写文章"',
    'text="写内容"',
    'text="创作"',
    'button:has-text("发布")',
    'button:has-text("写文章")',
    'a:has-text("发布")',
    '[class*="publish"]',
    '[class*="create"]',
    '[class*="write"]',
  ],
  titleSelectors: [
    'input[placeholder*="标题"]',
    'input[placeholder*="填写标题"]',
    'textarea[placeholder*="标题"]',
    'input[type="text"]',
  ],
  contentSelectors: [
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    'textarea',
    '[class*="editor"] div[contenteditable="true"]',
  ],
  imageInputSelectors: ['input[type="file"]'],
  // Text-first selectors only: a loose [class*="video"] would click random page
  // elements, so video tabs stay explicit and are skippable when absent.
  videoTabSelectors: [
    'text="上传视频"',
    'text="上傳影片"',
    'text="发视频"',
    'text="發視頻"',
    'button:has-text("上传视频")',
    '[role="tab"]:has-text("视频")',
    '[role="tab"]:has-text("影片")',
  ],
  videoInputSelectors: [
    'input[type="file"][accept*="video"]',
    'input[type="file"][accept*=".mp4"]',
    'input[type="file"]',
  ],
  videoUploadWaitMs: 20_000,
  publishButtonSelectors: [
    'button:has-text("发布")',
    'button:has-text("发表")',
    'button:has-text("提交")',
    '[role="button"]:has-text("发布")',
    'button:has-text("Post")',
    'button:has-text("Publish")',
  ],
  confirmButtonSelectors: [
    'button:has-text("确定")',
    'button:has-text("确认")',
    'button:has-text("发布")',
    'button:has-text("Confirm")',
  ],
  loginTextPatterns: ["登录", "登陆", "扫码登录", "验证码登录", "login", "sign in", "sign up"],
};

/**
 * Video-first platforms: the publish page *is* the uploader, so we jump straight
 * to it and skip the generic "new post" clicks. Selectors are best-effort.
 */
function videoFirstProfile(entry: {
  publishPageUrl: string;
  videoTabSelectors?: string[];
  publishButtonSelectors: string[];
  confirmButtonSelectors?: string[];
}): PlatformPublishProfile {
  return {
    ...genericProfile,
    publishPageUrl: entry.publishPageUrl,
    newPostSelectors: [],
    videoTabSelectors: entry.videoTabSelectors ?? [],
    publishButtonSelectors: entry.publishButtonSelectors,
    confirmButtonSelectors: entry.confirmButtonSelectors ?? [],
  };
}

/**
 * Text/article platforms whose publish URL opens straight into the editor (no
 * separate "new post" button). URLs and selectors are best-effort — platform
 * DOMs change often — and can be tuned here as they evolve.
 */
function articleEditorProfile(entry: {
  publishPageUrl: string;
  newPostSelectors?: string[];
  titleSelectors?: string[];
  contentSelectors?: string[];
  imageInputSelectors?: string[];
  publishButtonSelectors?: string[];
  confirmButtonSelectors?: string[];
  loginTextPatterns?: string[];
}): PlatformPublishProfile {
  return {
    ...genericProfile,
    publishPageUrl: entry.publishPageUrl,
    newPostSelectors: entry.newPostSelectors ?? [],
    titleSelectors: entry.titleSelectors ?? genericProfile.titleSelectors,
    contentSelectors: entry.contentSelectors ?? genericProfile.contentSelectors,
    imageInputSelectors: entry.imageInputSelectors ?? genericProfile.imageInputSelectors,
    // Article editors have no video tab to click.
    videoTabSelectors: [],
    publishButtonSelectors: entry.publishButtonSelectors ?? genericProfile.publishButtonSelectors,
    confirmButtonSelectors: entry.confirmButtonSelectors ?? [],
    loginTextPatterns: entry.loginTextPatterns ?? genericProfile.loginTextPatterns,
  };
}

export const defaultPublishProfiles: Partial<Record<AccountPlatform, PlatformPublishProfile>> = {
  小红书: {
    publishPageUrl: "https://creator.xiaohongshu.com/",
    newPostSelectors: [
      'text="发布笔记"',
      'text="发布"',
      'button:has-text("发布笔记")',
      'button:has-text("发布")',
      '[class*="publish"]',
      '[class*="create-note"]',
    ],
    titleSelectors: ['input[placeholder*="标题"]', 'input[placeholder*="填写标题"]', 'input[type="text"]'],
    contentSelectors: ['div[contenteditable="true"]', 'div[contenteditable="true"][role="textbox"]', 'textarea'],
    imageInputSelectors: ['input[type="file"]'],
    videoTabSelectors: ['[role="tab"]:has-text("视频")', 'text="上传视频"', 'text="发视频"'],
    videoInputSelectors: [
      'input[type="file"][accept*="video"]',
      'input[type="file"][accept*=".mp4"]',
      'input[type="file"]',
    ],
    videoUploadWaitMs: 45_000,
    publishButtonSelectors: ['button:has-text("发布")', 'button:has-text("发表")', '[role="button"]:has-text("发布")'],
    confirmButtonSelectors: ['button:has-text("确定")', 'button:has-text("确认")'],
    loginTextPatterns: ["登录", "登陆", "扫码登录", "验证码登录", "login", "sign in", "sign up"],
  },
  知乎: articleEditorProfile({
    publishPageUrl: "https://zhuanlan.zhihu.com/write",
    titleSelectors: ['textarea[placeholder="请输入标题"]', 'textarea[placeholder*="标题"]', 'input[placeholder*="标题"]'],
    contentSelectors: [
      'div[contenteditable="true"]',
      '.public-DraftEditor-content',
      '.DraftEditor-root div[contenteditable="true"]',
    ],
    publishButtonSelectors: ['button:has-text("发布")', '.WriteIndex-publishButton', 'button.Button--primary:has-text("发布")'],
    // 知乎 sometimes opens a "发布" confirmation popover/modal after the button.
    confirmButtonSelectors: [
      '[role="dialog"] button:has-text("发布")',
      '.Modal button:has-text("发布")',
      '[role="menu"] [role="menuitem"]:has-text("发布")',
      '[role="dialog"] button:has-text("确定")',
    ],
    loginTextPatterns: ["登录", "注册", "扫码登录"],
  }),
  头条号: articleEditorProfile({
    publishPageUrl: "https://mp.toutiao.com/profile_v4/graphic/publish",
    titleSelectors: ['textarea[placeholder*="标题"]', 'input[placeholder*="标题"]', 'input[placeholder="请输入文章标题"]'],
    contentSelectors: ['div[contenteditable="true"]', '.ProseMirror', 'div[contenteditable="true"][role="textbox"]'],
    publishButtonSelectors: ['button:has-text("预览并发布")', 'button:has-text("发布")'],
    confirmButtonSelectors: ['button:has-text("确定")', 'button:has-text("确认")'],
    loginTextPatterns: ["登录", "扫码登录"],
  }),
  百家号: articleEditorProfile({
    publishPageUrl: "https://baijiahao.baidu.com/builder/rc/edit?type=news",
    titleSelectors: ['textarea[placeholder*="标题"]', '#newsTextArea_title', 'input[placeholder*="标题"]', 'input[placeholder="请输入标题"]'],
    contentSelectors: ['div[contenteditable="true"]', 'div[contenteditable="true"][role="textbox"]', 'textarea'],
    publishButtonSelectors: ['button:has-text("发布")', 'button:has-text("存草稿")'],
    loginTextPatterns: ["登录", "百度账号登录", "扫码登录"],
  }),
  微信公众号: articleEditorProfile({
    publishPageUrl: "https://mp.weixin.qq.com/",
    newPostSelectors: ['text="图文消息"', 'text="新的创作"', '.new-creation__menu-item'],
    titleSelectors: ['input#title', 'input[placeholder*="标题"]', 'textarea[placeholder*="标题"]'],
    contentSelectors: ['#ueditor_0 div[contenteditable="true"]', 'div[contenteditable="true"]', '.ProseMirror'],
    publishButtonSelectors: ['button:has-text("群发")', 'button:has-text("发表")', 'button:has-text("保存并群发")'],
    loginTextPatterns: ["登录", "扫码登录", "微信公众平台"],
  }),
  微博: articleEditorProfile({
    publishPageUrl: "https://card.weibo.com/article/v3/editor",
    titleSelectors: ['input[placeholder*="标题"]', 'textarea[placeholder*="标题"]'],
    contentSelectors: ['div[contenteditable="true"]', '.public-DraftEditor-content', '.WBPanelEditor'],
    publishButtonSelectors: ['button:has-text("发布")', 'a:has-text("发布")'],
    loginTextPatterns: ["登录", "注册"],
  }),
  企鹅号: articleEditorProfile({
    publishPageUrl: "https://om.qq.com/article/articlePublish",
    titleSelectors: ['input[placeholder*="标题"]', 'textarea[placeholder*="标题"]'],
    contentSelectors: ['div[contenteditable="true"]', '.ql-editor'],
    publishButtonSelectors: ['button:has-text("发布")', 'button:has-text("发表")'],
    loginTextPatterns: ["登录", "QQ登录", "扫码登录"],
  }),
  搜狐号: articleEditorProfile({
    publishPageUrl: "https://mp.sohu.com/mpfe/v4/contentManagement/news/addArticle",
    titleSelectors: ['input[placeholder*="标题"]', 'textarea[placeholder*="标题"]'],
    contentSelectors: ['div[contenteditable="true"]', '.ql-editor'],
    publishButtonSelectors: ['button:has-text("发布")', 'button:has-text("确定")'],
    loginTextPatterns: ["登录", "扫码登录"],
  }),
  大鱼号: articleEditorProfile({
    publishPageUrl: "https://mp.dayu.com/dashboard/index",
    newPostSelectors: ['text="发布文章"', 'text="文章"', 'a:has-text("发布")'],
    titleSelectors: ['input[placeholder*="标题"]', 'textarea[placeholder*="标题"]'],
    contentSelectors: ['div[contenteditable="true"]', '.ql-editor'],
    publishButtonSelectors: ['button:has-text("发布")'],
    loginTextPatterns: ["登录", "账号登录"],
  }),
  快传号: articleEditorProfile({
    publishPageUrl: "https://kuaichuan.360kuai.com/",
    newPostSelectors: ['text="发布"', 'text="文章"'],
    titleSelectors: ['input[placeholder*="标题"]', 'textarea[placeholder*="标题"]'],
    contentSelectors: ['div[contenteditable="true"]', '.ql-editor', 'textarea'],
    publishButtonSelectors: ['button:has-text("发布")'],
    loginTextPatterns: ["登录", "扫码登录"],
  }),
  豆瓣: articleEditorProfile({
    publishPageUrl: "https://www.douban.com/note/create",
    titleSelectors: ['#note-title', 'input[placeholder*="标题"]'],
    contentSelectors: ['#link-report div[contenteditable="true"]', 'div[contenteditable="true"]', 'textarea'],
    publishButtonSelectors: ['button:has-text("保存")', 'input[type="submit"]', 'button:has-text("发布")'],
    loginTextPatterns: ["登录", "注册"],
  }),
  CSDN: articleEditorProfile({
    publishPageUrl: "https://editor.csdn.net/md/",
    titleSelectors: ['input[placeholder*="标题"]', '.article-bar input'],
    contentSelectors: ['div[contenteditable="true"]', '.editor__inner', 'textarea'],
    publishButtonSelectors: ['button:has-text("发布文章")', 'button:has-text("发布")'],
    confirmButtonSelectors: ['button:has-text("确定")'],
    loginTextPatterns: ["登录", "扫码登录"],
  }),
  简书: articleEditorProfile({
    publishPageUrl: "https://www.jianshu.com/writer",
    titleSelectors: ['input[placeholder*="标题"]'],
    contentSelectors: ['div[contenteditable="true"]', '.ql-editor'],
    publishButtonSelectors: ['button:has-text("发布文章")', 'a:has-text("发布文章")', 'button:has-text("发布")'],
    loginTextPatterns: ["登录", "注册"],
  }),
  淘宝光合: articleEditorProfile({
    publishPageUrl: "https://creator.guanghe.taobao.com/",
    newPostSelectors: ['text="发布"', 'text="内容"'],
    titleSelectors: ['input[placeholder*="标题"]', 'textarea[placeholder*="标题"]'],
    contentSelectors: ['div[contenteditable="true"]', 'textarea'],
    publishButtonSelectors: ['button:has-text("发布")'],
    loginTextPatterns: ["登录", "扫码登录"],
  }),
  Threads: {
    publishPageUrl: "https://www.threads.com/",
    newPostSelectors: ['[aria-label="Create"]', '[aria-label="New thread"]', '[aria-label*="New thread"]', '[aria-label*="Create"]'],
    titleSelectors: [],
    contentSelectors: ['div[contenteditable="true"][role="textbox"]', 'div[contenteditable="true"]', 'textarea'],
    imageInputSelectors: ['input[type="file"]'],
    videoTabSelectors: [],
    videoInputSelectors: ['input[type="file"][accept*="video"]', 'input[type="file"]'],
    videoUploadWaitMs: 45_000,
    publishButtonSelectors: [
      '[role="dialog"] div[role="button"]:has-text("Post")',
      '[role="dialog"] button:has-text("Post")',
      'div[role="button"]:has-text("Post")',
      'button:has-text("Post")',
    ],
    confirmButtonSelectors: [],
    loginTextPatterns: ["log in", "sign up", "login to see", "continue with instagram"],
  },
  抖音: videoFirstProfile({
    publishPageUrl: "https://creator.douyin.com/creator-micro/content/upload",
    publishButtonSelectors: ['button:has-text("发布")', 'button:has-text("發布")'],
  }),
  哔哩哔哩: videoFirstProfile({
    publishPageUrl: "https://member.bilibili.com/platform/upload/video/frame",
    publishButtonSelectors: ['button:has-text("立即投稿")', 'span:has-text("立即投稿")', 'button:has-text("投稿")'],
  }),
  视频号: videoFirstProfile({
    publishPageUrl: "https://channels.weixin.qq.com/platform/post/create",
    publishButtonSelectors: ['button:has-text("发表")', 'button:has-text("发布")'],
  }),
  快手: videoFirstProfile({
    publishPageUrl: "https://cp.kuaishou.com/article/publish/video",
    publishButtonSelectors: ['button:has-text("发布")', 'div[role="button"]:has-text("发布")'],
  }),
  YouTube: videoFirstProfile({
    publishPageUrl: "https://www.youtube.com/upload",
    publishButtonSelectors: [
      "#done-button",
      'tp-yt-paper-button:has-text("Publish")',
      'button:has-text("Publish")',
      'button:has-text("Save")',
    ],
  }),
  TikTok: videoFirstProfile({
    publishPageUrl: "https://www.tiktok.com/tiktokstudio/upload",
    publishButtonSelectors: ['button:has-text("Post")', 'button:has-text("发布")'],
  }),
};

/**
 * Publish profiles are built-in defaults only — there is no per-install override
 * stored in the database anymore.
 *
 * Kept `async` so existing `await getPublishProfile(...)` callers stay valid.
 */
export async function getPublishProfile(platform: AccountPlatform): Promise<PlatformPublishProfile> {
  return defaultPublishProfiles[platform] ?? genericProfile;
}
