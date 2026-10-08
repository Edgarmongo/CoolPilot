import { getAccount } from "@/db/repository";
import { firstPage, launchSiteProfileContext } from "@/lib/browser";

async function main() {
  const accountId = process.argv[2];
  if (!accountId) {
    throw new Error("Missing accountId");
  }
  const site = await getAccount(accountId);
  if (!site) {
    throw new Error(`Site not found: ${accountId}`);
  }

  const context = await launchSiteProfileContext(site.profilePath);
  const page = await firstPage(context);
  await page.goto(site.url || "https://www.threads.net/", {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  console.log(`[open-profile] Opened ${site.name}. Close the browser window when done.`);
  await new Promise<void>((resolve) => context.on("close", () => resolve()));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
