import { accountPlatforms, type AccountPlatform, type AccountRecord } from "@/lib/types";

/** Every platform offered when picking an account's platform. */
export const platformOptions: AccountPlatform[] = [...accountPlatforms];

/** Default landing URL used when a platform is chosen in the add/edit form. */
export const platformDefaultUrls: Record<AccountPlatform, string> = {
  头条号: "https://mp.toutiao.com/",
  百家号: "https://baijiahao.baidu.com/",
  微信公众号: "https://mp.weixin.qq.com/",
  抖音: "https://www.douyin.com/",
  小红书: "https://www.xiaohongshu.com/",
  知乎: "https://www.zhihu.com/",
  哔哩哔哩: "https://member.bilibili.com/",
  微博: "https://weibo.com/",
  企鹅号: "https://om.qq.com/",
  快手: "https://www.kuaishou.com/",
  视频号: "https://channels.weixin.qq.com/",
  淘宝光合: "https://www.taobao.com/",
  搜狐号: "https://mp.sohu.com/",
  大鱼号: "https://mp.dayu.com/",
  快传号: "https://www.360kuai.com/",
  豆瓣: "https://www.douban.com/",
  CSDN: "https://www.csdn.net/",
  简书: "https://www.jianshu.com/",
  Threads: "https://www.threads.com/",
  Facebook: "https://www.facebook.com/",
  Instagram: "https://www.instagram.com/",
  LinkedIn: "https://www.linkedin.com/",
  YouTube: "https://www.youtube.com/",
  TikTok: "https://www.tiktok.com/",
  WordPress: "https://wordpress.com/",
  InnoShop: "https://www.innoshop.com/",
  PbootCMS: "https://www.pbootcms.com/",
  Other: "",
};

export function defaultUrlForPlatform(platform: AccountRecord["platform"]) {
  return platformDefaultUrls[platform];
}

/** Simple account record shape used by the add/edit forms. */
export type AccountFormState = {
  name: string;
  platform: AccountRecord["platform"];
  url: string;
  account: string;
  memo: string;
  status: AccountRecord["status"];
};

export function changeAccountFormPlatform(form: AccountFormState, platform: AccountRecord["platform"], updateUrl: boolean) {
  return {
    ...form,
    platform,
    url: updateUrl ? defaultUrlForPlatform(platform) : form.url,
  };
}

export function createEmptyAccountForm(): AccountFormState {
  return {
    name: "",
    platform: "Threads",
    url: defaultUrlForPlatform("Threads"),
    account: "",
    memo: "",
    status: "needs_login",
  };
}
