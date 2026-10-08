import { chromium } from "playwright";

/**
 * Dev-only smoke check for 系统 / 模型管理: renders the catalog page in a real
 * browser and asserts the imported gateway models are on screen. Requires
 * `next dev` / `next start` on the given base URL.
 *
 * Usage: tsx scripts/model-management-smoke.ts [baseUrl] [locale]
 */
const baseUrl = (process.argv[2] ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const locale = process.argv[3] ?? "zh-cn";

async function main() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const response = await page.goto(`${baseUrl}/${locale}/system/models`, { waitUntil: "networkidle" });
    if (!response || !response.ok()) {
      throw new Error(`Page request failed: ${response?.status()}`);
    }

    const firstModel = "gpt-5.6-sol";
    await page.getByRole("button", { name: firstModel, exact: true }).first().waitFor({ timeout: 30_000 });

    // Feature switch + credential form used to sync the user's own gateway account.
    const gatewayTitle = page.locator("h3", { hasText: /模型網關同步|模型网关同步|Gateway model sync/ }).first();
    await gatewayTitle.waitFor({ timeout: 30_000 });
    const gatewayToggle = (await page.getByRole("switch").first().innerText()).replace(/\s+/g, " ").trim();
    const gatewaySyncButton = await page.locator("button", { hasText: /同步模型|Sync models/ }).count();

    const modelTags = page.locator("button[title]");
    const tagCount = await modelTags.count();
    const allModelsChip = (await page.locator("button", { hasText: /全部模型|All models/ }).first().innerText()).replace(/\s+/g, " ").trim();
    const vendorHeadings = await page.locator("section p.font-semibold").count();
    const note = (await page.locator("p", { hasText: /import-gateway-models/ }).first().innerText()).replace(/\s+/g, " ").trim();

    console.log(
      JSON.stringify(
        { ok: true, locale, firstModel, tagCount, allModelsChip, vendorHeadings, note, gatewayToggle, gatewaySyncButton },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}

void main();
