import type { AppStoreAgent, AppStoreCategory } from "@/lib/types";
import { appStoreCategories } from "@/lib/types";

function agent(
  id: string,
  name: string,
  emoji: string,
  tagline: string,
  description: string,
  category: AppStoreCategory,
  tags: string[],
): AppStoreAgent {
  return { id, name, emoji, tagline, description, category, tags, official: true };
}

/**
 * Built-in "official" writing agents shown on the app-store browse tab. There is no remote
 * marketplace yet, so this static catalog stands in for the reviewed listings.
 */
export const officialAgents: AppStoreAgent[] = [
  agent("emotional-story", "情感故事写手", "🕯️", "把说不出口的心事，写进故事里", "擅长把细腻的情感写成动人的故事：先共鸣再表达，克制但有力量，适合公众号与小红书的情感内容。", "content", ["情感", "散文", "成长"]),
  agent("hot-commentator", "热点评论员", "🗣️", "吵翻天之前，先把事说清楚", "一个热点只抓一个论点，先给结论再展开论据。观点鲜明、逻辑清晰，不煽情但让人愿意读下去。", "content", ["时事", "评论", "议论文"]),
  agent("funny-news", "搞笑新闻专家", "😄", "把新闻讲成让人会心一笑的段子", "用段子和口语解说热点，先把事实讲明白，再抖包袱。适合短视频口播脚本与轻松向图文。", "content", ["搞笑", "热点", "短视频"]),
  agent("weixin-staff-writer", "公众号爆款写手", "📰", "标题能开局，正文能留人", "擅长长图文结构：开局用场景钩住读者，中段给信息增量，结尾留互动问题，提升打开率与完读率。", "content", ["公众号", "长文", "标题"]),
  agent("xiaohongshu-seeder", "小红书种草文", "✨", "三行抓住眼球，一段讲透体验", "把产品或体验写成真实分享：口语化、分点清晰、带情绪价值，结尾自然给出行动建议。", "content", ["小红书", "种草", "生活"]),
  agent("it-news", "IT 新闻专家", "💻", "科技热点，先给结论再讲人话", "深度剖析新品、政策与 AI 动态。不堆术语，用大白话串联来龙去脉，帮读者把信息变成判断。", "tech", ["科技热点", "AI", "解读"]),
  agent("phone-reviewer", "手机评测师", "📱", "只讲你用得上的参数与体验", "从手感、续航、影像到系统流畅度，给出可落地的选购建议，不堆参数、不吹不黑。", "tech", ["手机", "评测", "导购"]),
  agent("ai-tool-advisor", "AI 工具顾问", "🤖", "把复杂的 AI 说成人人能用的一招", "专挑高频、可复现的 AI 用法：每步都有示例与提示词，讲清这个工具能解决什么真实问题。", "tech", ["AI工具", "效率", "提示词"]),
  agent("programmer-notes", "程序员笔记", "💾", "踩过的坑，替你填平", "面向一线开发的实战笔记：复现步骤、报错原因、修复方案一次讲透，附最小可运行示例。", "tech", ["编程", "教程", "踩坑"]),
  agent("gadget-buying-guide", "数码选购指南", "🛒", "花对钱，买对货", "按预算与场景横向对比数码产品，说清取舍逻辑，帮读者在参数之外做决定。", "tech", ["数码", "选购", "性价比"]),
  agent("marketing-copywriter", "营销文案专家", "📣", "结合产品卖点，写出有转化的文案", "围绕用户痛点提炼卖点，用利益点与场景化表达驱动行动，兼顾品牌调性与转化目标。", "marketing", ["营销", "文案", "转化"]),
  agent("brand-storyteller", "品牌故事官", "🏷️", "让品牌被记住，而不是被刷过", "把品牌理念拆成人可以共情的故事：起点、坚持与承诺，让每一次表达都沉淀信任。", "marketing", ["品牌", "故事", "公关"]),
  agent("private-domain-operator", "私域运营官", "💬", "把流量变成会复购的朋友", "社群与个人号的内容节奏设计：拉新话术、日常维护、复购触达，一套可执行的私域打法。", "marketing", ["私域", "社群", "复购"]),
  agent("livestream-scriptwriter", "直播话术师", "🎤", "上链接之前，先讲清为什么买", "按直播节奏拆解话术：开场留人、痛点共鸣、卖点证明、逼单收口，节奏紧凑不复读。", "marketing", ["直播", "话术", "带货"]),
  agent("campaign-planner", "活动策划官", "🎯", "让一次活动带来一整年的口碑", "从目标拆到执行：主题、机制、传播链路与复盘指标，一场活动一次讲清。", "marketing", ["活动", "策划", "增长"]),
  agent("home-cook", "家常菜谱师", "🍳", "新手也能一次做成的家常菜", "把步骤拆到最小：食材、火候、时间与翻车点，普通人照着做就能复刻。", "life", ["美食", "菜谱", "快手菜"]),
  agent("health-coach", "健康养生讲师", "🌿", "顺节气过日子，把身体养回来", "从作息、饮食与情绪三条线讲养生，讲清依据、不夸大功效，给可持续的小习惯。", "life", ["健康", "养生", "作息"]),
  agent("travel-planner", "旅行攻略家", "🧭", "少花冤枉路，多看真风景", "按天给路线、交通与预算，标注最佳时段与避坑提醒，让攻略能直接照抄执行。", "life", ["旅行", "攻略", "路线"]),
  agent("home-organizer", "家居整理师", "🧺", "让家变清爽的收纳心法", "按空间与动线给收纳方案，先断舍离再选工具，讲清为什么这样放更好用。", "life", ["家居", "收纳", "好物"]),
  agent("style-consultant", "穿搭顾问", "👗", "普通人的衣柜，也能搭出高级感", "按身材、场合与预算做搭配，强调可复用单品与配色逻辑，不追爆款也能好看。", "life", ["穿搭", "时尚", "配色"]),
  agent("book-reader", "读书领读人", "📚", "一本好书，讲成睡前的一小时", "把一本书的骨架与金句讲透：为什么值得读、关键观点是什么、读完能带走什么。", "hobby", ["读书", "书评", "认知"]),
  agent("history-teller", "历史讲述者", "🏛️", "历史不是年份，是人怎么活过", "用人物与细节还原时代，讲清因果与争议，让历史读起来像故事但有据可查。", "hobby", ["历史", "人文", "故事"]),
  agent("classics-teacher", "国学文化讲师", "🖋️", "把古人的话，讲进今天的生活", "从经典原文出发，先释义再联系当下处境，让古文的智慧变成可用的处世方法。", "hobby", ["国学", "文化", "经典"]),
  agent("film-explainer", "影视讲解员", "🎬", "看懂镜头背后的那点意思", "按情节线讲解，穿插视听语言与主题分析，不剧透关键反转也能讲出看点。", "hobby", ["影视", "解说", "剧评"]),
  agent("music-appreciator", "音乐鉴赏家", "🎧", "一首歌，听见一段人生", "从编曲、歌词与时代背景切入，讲清一首歌为什么动人，并给出同风格歌单。", "hobby", ["音乐", "鉴赏", "歌单"]),
  agent("career-coach", "职场干货导师", "💼", "把职场弯路，讲成一句可执行的话", "针对汇报、沟通、跳槽与晋升给具体话术与步骤，不喊口号，只给能马上用的方法。", "business", ["职场", "沟通", "管理"]),
  agent("productivity-officer", "效率工具官", "⚙️", "每天省下一小时的工具与方法", "专挑真实高频场景，讲清工具怎么配、流程怎么改，让效率提升可被量化。", "business", ["效率", "工具", "方法"]),
  agent("startup-reviewer", "创业复盘者", "🚀", "真实复盘，不吹故事", "按阶段复盘抉择与踩坑：数据怎么读、成本怎么控、下一步怎么走，全部基于真实案例。", "business", ["创业", "复盘", "商业"]),
  agent("ecommerce-operator", "电商运营官", "🛍️", "从选品到复购的全链路打法", "覆盖选品、详情页、流量与复购，每一步都给可执行动作与判断指标。", "business", ["电商", "运营", "选品"]),
  agent("project-management-coach", "项目管理教练", "📋", "把复杂的事，拆成能做完的事", "教你把目标拆成任务、排期与责任，讲清如何开好会、跟好进度、控住风险。", "business", ["项目管理", "协作", "流程"]),
  agent("finance-commentator", "财经解读官", "📈", "看懂新闻背后的钱", "把财经新闻翻译成生活语言：谁受影响、影响多大、普通人该关注什么信号。", "finance", ["财经", "解读", "宏观"]),
  agent("family-finance-advisor", "家庭理财师", "💰", "工资之外，先把钱管明白", "从记账、应急金到配置比例讲清家庭财务，强调稳健与纪律，不推荐具体产品。", "finance", ["理财", "家庭", "规划"]),
  agent("fund-explainer", "基金科普员", "📊", "用大白话讲清基金那点事", "拆解基金类型、费用与风险，讲清定投逻辑与常见误区，帮读者建立自己的判断。", "finance", ["基金", "投资", "科普"]),
  agent("business-observer", "商业观察员", "🔍", "把生意拆开给你看", "从商业模式、成本结构与竞争格局拆解真实公司，讲清它为什么赚钱、又卡在哪里。", "finance", ["商业", "观察", "案例"]),
  agent("spending-guide", "消费省钱指南", "🧾", "不降品质，只降价格", "用比价、替代与时机选择帮读者把钱花在刀刃上，方法可复用、不涉及虚假优惠。", "finance", ["消费", "省钱", "好物"]),
  agent("foreign-trade-copywriter", "外贸文案专家", "🌐", "产品卖点直译，不如本地化重写", "为出海产品做本地化文案：术语、度量与合规一次讲清，兼顾搜索友好与转化。", "trade", ["外贸", "本地化", "多语言"]),
  agent("cross-border-guide", "跨境电商向导", "✈️", "亚马逊与独立站的选品与合规", "讲清选品逻辑、listing 结构与合规红线，帮卖家少踩坑、把投入花在正确的环节。", "trade", ["跨境电商", "亚马逊", "合规"]),
  agent("sales-scriptwriter", "销售话术官", "🤝", "先听懂需求，再谈成交", "按销售阶段拆解话术：提问挖需、价值陈述、异议处理与推进节点，拒绝硬推。", "trade", ["销售", "话术", "成交"]),
  agent("franchise-advisor", "招商加盟顾问", "🏬", "把模式讲清，把风险说明", "从加盟模式、投入产出到合同要点讲清利弊，帮助加盟双方做更理性的决策。", "trade", ["招商", "加盟", "运营"]),
  agent("bidding-writer", "招投标文书师", "📑", "把标书写成让评委放心的样子", "按评分项组织标书结构：响应要点、参数对照与资质证明，做到条条有据、重点突出。", "trade", ["招投标", "文书", "标书"]),
];

/** Aggregates agents into the category counts shown on the storefront filter chips. */
export function summarizeAppStore(agents: AppStoreAgent[]) {
  const categoryCounts = appStoreCategories.reduce(
    (acc, category) => ({ ...acc, [category]: 0 }),
    {} as Record<AppStoreCategory, number>,
  );
  for (const entry of agents) {
    categoryCounts[entry.category] += 1;
  }
  return { agents, categoryCounts, total: agents.length };
}
