import { chromium } from "playwright";
import { localeResources, normalizeLocale } from "../src/lib/locale-resources";
import type { LocaleDictionary, TranslationKey } from "../src/lib/locale-resources";
import type { WorkspaceManifest } from "../src/lib/workspace/manifest";
import { buildWorkspaceOverview } from "../src/lib/workspace/overview";
import type { WorkspaceFactPart } from "../src/lib/workspace/overview";

/**
 * Dev-only smoke check for System / Workspace (P5-B0-3-B): renders the overview in a real browser
 * and asserts the screen shows the workspace the API reports. Requires `next dev` / `next start` on
 * the given base URL.
 *
 * What is expected on screen is computed from the same response the page reads, through the same
 * view model (`buildWorkspaceOverview`), so this check does not encode one developer's workspace:
 * run it against a used install and an empty one and it still describes what should be there. What
 * it pins is the part unit tests cannot see - that the browser actually calls
 * `GET /api/workspace/manifest`, that the keys resolve in the requested locale, and that the numbers
 * reach the DOM.
 *
 * Usage: tsx scripts/workspace-overview-smoke.ts [baseUrl] [locale]
 */
const baseUrl = (process.argv[2] ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const locale = process.argv[3] ?? "en";

type ManifestResponse = { ok: boolean; data: WorkspaceManifest };

/** The same interpolation `src/lib/i18n` does, so a key the locale file is missing shows up here. */
function translate(dictionary: LocaleDictionary, key: TranslationKey, values?: Record<string, string | number>) {
  return Object.entries(values ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    dictionary[key] ?? key,
  );
}

function renderPart(dictionary: LocaleDictionary, part: WorkspaceFactPart) {
  return "text" in part ? part.text : translate(dictionary, part.key, part.values);
}

async function main() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    const response = await page.goto(`${baseUrl}/${locale}/system/workspace`, { waitUntil: "domcontentloaded" });
    if (!response || !response.ok()) {
      throw new Error(`Page request failed: ${response?.status()}`);
    }

    const manifest = (await page.evaluate(async () => (await fetch("/api/workspace/manifest")).json())) as ManifestResponse;
    if (!manifest.ok) {
      throw new Error("GET /api/workspace/manifest did not answer ok");
    }

    const overview = buildWorkspaceOverview(manifest.data);
    // The numbers only exist after the page has hydrated and its own fetch came back, so wait for
    // the workspace path it is going to print rather than for a delay.
    await page
      .waitForFunction((root) => document.body.innerText.includes(root), overview.root, { timeout: 30_000 })
      .catch(() => {
        throw new Error(`Workspace root never rendered. Page errors: ${pageErrors.join(" | ") || "none"}`);
      });

    const cardText = (await page.locator("section").allInnerTexts()).join("\n").replace(/\s+/g, " ");
    const labels = await page.locator("section h2").allInnerTexts();

    const dictionary = localeResources[normalizeLocale(locale)];
    // Every word the view model asks for, rendered the way the console renders it: a key missing
    // from this locale file would stay a raw key here and fail the check below.
    const expected = [
      translate(dictionary, "wsSectionDatabase"),
      translate(dictionary, "wsSectionArtifacts"),
      translate(dictionary, "wsSectionProfiles"),
      translate(dictionary, "wsSectionVideos"),
      translate(dictionary, "wsAttentionTitle"),
      overview.root,
      ...overview.rows.flatMap((row) => [
        renderPart(dictionary, row.primary),
        ...row.secondary.map((part) => renderPart(dictionary, part)),
      ]),
      ...(overview.attentionCount > 0
        ? [translate(dictionary, "wsAttentionItems", { count: overview.attentionCount })]
        : [translate(dictionary, "wsAttentionEmpty")]),
      translate(dictionary, "wsAttentionNote"),
      ...overview.attention.flatMap((item) => [
        translate(dictionary, item.labelKey, { count: item.count }),
        ...item.names,
      ]),
    ];
    const missing = [...new Set(expected)].filter((needle) => !cardText.includes(needle));
    if (missing.length) {
      throw new Error(`Not on screen: ${missing.join(" | ")}`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          locale,
          url: page.url(),
          headings: labels.map((label) => label.replace(/\s+/g, " ").trim()),
          root: overview.root,
          rows: overview.rows.map((row) => ({ id: row.id, empty: row.empty })),
          attention: overview.attention.map((item) => ({ id: item.id, count: item.count, shown: item.names.length })),
          attentionCount: overview.attentionCount,
          checkedFragments: [...new Set(expected)].length,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}

void main();
