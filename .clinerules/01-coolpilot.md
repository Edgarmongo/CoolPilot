# CoolPilot 开发规则

> 本文件与仓库根目录 `AGENTS.md` 的 `<!-- BEGIN:coolpilot-project-rules -->` 一节**必须保持一致**；改一处就同改另一处。
>
> 两处都放的原因：不同 Cline 版本读取的规则文件不同（有的读 `.clinerules/`，有的读 `AGENTS.md`）。经本次核验，**本仓库 `AGENTS.md` 是当前环境确实会读取的规则文件**（本次会话的系统上下文即注入了它的内容），而 `CLAUDE.md` 只有一行 `@AGENTS.md`。
>
> `AGENTS.md` 顶部的 `<!-- BEGIN:nextjs-agent-rules -->` 区块（要求写代码前先读 `node_modules/next/dist/docs/`）**不得删除或改写**。

## 1. 文档优先级

开始任何开发前必须读：

1. `docs/coolpilot-capability-integration-plan.md`（当前主线；**§1 任务状态表是唯一进度来源**）
2. `docs/development/capability-integration-numbering-map.md`（新旧编号对照 + 工作区基线；引用历史卡片前先查这里）
3. `docs/development/CoolPilot-开发清单-10个开源项目整合版.md`（最新版清单；**2026-10-10 已入库，完整性核对通过**：867 行，P0-01…P8-07 无缺口）
4. `docs/data-model-inventory.md`、`docs/menu-inventory.md`、`docs/coolpilot-integration-contracts.md`
5. 当前代码与测试（**以实际代码为准，不以文档声称的功能为准**）

文档与代码不一致时：**先报告差异**（文件、行号、两边的数字各是多少），不自行判断谁对，也不顺手「修正」文档。

## 2. 产品方向不可偏离

Local-first、用户数字主权、Community 免费基础能力、Pro / Creator / Business 分层增值、Agent / Workflow Marketplace 长期方向。不得为单个功能破坏上述方向。

## 3. 开发纪律

- 一次只做**一张卡**；编码前先检查现有实现、调用链、数据模型、测试与工作区状态。
- 优先复用现有架构，避免重复实现；不得擅自大规模重构、删除兼容逻辑或修改无关文件。
- **不得覆盖、清理、重置、stash 或提交**用户未提交的工作（基线见编号对照文档）。
- 未经明确授权，不执行 `git add` / `git commit` / `git push`。
- 不在缺少幂等键与恢复策略时自动重试可能产生平台副作用的发布。

## 4. 冻结面（不得重写）

- **AI Runtime**：所有模型调用必须经过 `src/features/ai-runtime`，不得旁路新建调用路径。
- **C2 发布语义**：`recordPublishSuccess` 的写入顺序（先 `publish_records`，再 `content_items.status`）与 verify 消费 receipt 的语义不得更改。
- 已关闭的 P0 结论与 P1 Card 1 结论不得重开。
- 确需改冻结面时：先单独说明原因并等待批准，不得顺带改。

## 5. AI Runtime 与成本账本

- Runtime 负责执行与请求追踪，**不引入数据库依赖**；账本写入走既有调用层与 repository。
- **不得把未知成本、缺失价格或缺失用量伪装成 0**；必须区分 `provider-reported` / `computed` / `unpriced` / `unknown` 四种 `cost_source`。
- `computed`（依价格目录估算）**不得**表述为供应商实收；金额为 NULL 时不得写 0。
- 一条价格只计价它自己那个计量维度；维度或单位不匹配时费用必须保持 NULL 与 `unpriced`。
- **不得仅依据 `attemptIndex` 推断重试类型**（密钥轮换、模型降级、自纠重试都 > 0）；应沿 `parentUsageId` 读前行的 `outcome` 与身份。
- 新增 AI 能力必须声明计量方式、费用归属与用量上报能力。
- 日志、账本与错误信息中**不得**出现 API Key、Cookie 等凭据；账本不保存完整提示词。

## 6. 隐私默认值

不默认保存完整 Prompt / Response；不上传本地素材；不采集浏览器 Cookie 或登录态。

## 7. 验证与交付

- `pnpm` 的 build 脚本被忽略，用直连二进制验证：`node_modules\.bin\tsc.cmd --noEmit`、`node_modules\.bin\vitest.cmd run`、`node_modules\.bin\eslint.cmd .`。
- 打包后的 Electron 行为以**打包产物**验证为准，不能只看 dev server。
- 每张卡交付必须写明：改动内容 / 调用链路 / 验证结果（实际命令与结果，未运行的要标注）/ 遗留问题（区分阻塞与可延后）/ 下一步编号。
- 不得把未运行的测试写成通过；不得把模拟实现描述为真实能力。
- 遇到不明确需求、破坏性迁移或架构冲突 → 先暂停并报告，不自行扩大任务范围。
