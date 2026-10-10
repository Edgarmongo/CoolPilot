import { chromium } from "playwright";
import { localeResources, normalizeLocale } from "../src/lib/locale-resources";
import type { LocaleDictionary, TranslationKey } from "../src/lib/locale-resources";
import {
  platformTextLimitMessage,
  platformVersionDeriveTargets,
  platformVersionSourceLabelKeys,
} from "../src/lib/platform-version-view";
import type { PlatformContentVersionPayload } from "../src/lib/types";

/**
 * Dev-only smoke check for 多平台内容版本管理 UI (CI-P2-07): drives the platform-version panel inside
 * the content library detail dialog with a real browser, against a running `next dev` / `next start`.
 *
 * What unit tests and static rendering cannot see is what this pins: that the panel is really mounted
 * in the dialog, that its buttons call `POST` / `PATCH` / `DELETE /api/content/[id]/platform-versions`
 * with what the author typed, and that the answer is what comes back on screen (count, source badge,
 * notices) - with no publish record and no content status change anywhere in the loop (P2-07-05).
 *
 * Expected screen text comes from this locale's own dictionary, so a key missing from the locale file
 * shows up here as a raw key; the platforms driven are the ones the panel itself offers
 * (`platformVersionDeriveTargets`), not a list written into this file.
 *
 * It creates one content item, exercises it and deletes it again. **Run it against an isolated
 * database** (`SOCIAL_AUTO_POST_DB_URL=file:.../smoke.db`), not against a workspace you care about.
 *
 * Usage: tsx scripts/platform-versions-ui-smoke.ts [baseUrl] [locale]
 */
const baseUrl = (process.argv[2] ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const locale = normalizeLocale(process.argv[3] ?? "zh-cn");
const dictionary = localeResources[locale] as LocaleDictionary;

const failures: string[] = [];

/** The same interpolation `src/lib/i18n` does, so a missing key stays visible as a raw key. */
function translate(key: TranslationKey, values?: Record<string, string | number>) {
  return Object.entries(values ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    dictionary[key] ?? key,
  );
}

function step(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok || detail === undefined ? "" : ` (${JSON.stringify(detail)})`}`);
  if (!ok) failures.push(label);
}

type VersionsResponse = { ok: boolean; data: PlatformContentVersionPayload };
type ContentResponse = { ok: boolean; data: { id: string; status: string } };

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = (await response.json()) as T;
  if (!response.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function versions(id: string) {
  return (await json<VersionsResponse>(`/api/content/${id}/platform-versions`)).data;
}

async function main() {
  const timestamp = Date.now();
  const title = `CI-P2-07 UI smoke ${timestamp}`;
  const created = await json<ContentResponse>("/api/content", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, body: "ui smoke base body text", type: "article" }),
  });
  const id = created.data.id;
  const publishRecordsBefore = (await json<{ ok: boolean; data: unknown[] }>("/api/publish-records")).data.length;

  const initial = await versions(id);
  const ascii = (value: string) => /^[\x20-\x7E]+$/.test(value);
  const targets = platformVersionDeriveTargets(initial.profiles, initial.versions);
  const withTitle = targets.find((profile) => profile.titleField && ascii(profile.platform));
  const withoutTitle = targets.find((profile) => !profile.titleField && ascii(profile.platform));
  if (!withTitle || !withoutTitle) {
    throw new Error("the platform vocabulary offers no ASCII profile with and without a title field");
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  try {
    const response = await page.goto(`${baseUrl}/${locale}/content/library`, { waitUntil: "domcontentloaded" });
    if (!response || !response.ok()) throw new Error(`the content library page failed: ${response?.status()}`);

    // The card carrying the title opens the detail dialog - the same entry the author clicks.
    await page.getByText(title, { exact: false }).first().click();
    const dialog = page.getByRole("dialog");
    // `innerText` returns what the CSS shows, and the panel's headings are uppercased by CSS, so the
    // comparison is case-insensitive - otherwise the English run fails on the heading alone.
    const panelText = async () => (await dialog.innerText()).replace(/\s+/g, " ").toLowerCase();
    const expectOnScreen = async (label: string, needle: string) => {
      step(label, (await panelText()).includes(needle.toLowerCase()), needle);
    };
    const clickButton = async (name: string) => {
      await dialog.getByRole("button", { name, exact: true }).first().click();
    };
    const waitOnScreen = async (needle: string) => {
      await dialog.getByText(needle, { exact: false }).first().waitFor({ timeout: 30_000 });
    };
    const chooseTarget = async (platform: string) => {
      await dialog.getByLabel(translate("pvDeriveTarget")).selectOption(platform);
    };

    // The count badge only exists once the payload has arrived, so it is the signal that the panel is
    // past its loading state - waiting on the hint (which renders either way) would check too early.
    await waitOnScreen(translate("pvCount", { count: 0 }));
    step("the panel is mounted in the dialog", (await panelText()).includes(translate("pvTitle").toLowerCase()));
    await expectOnScreen("a fresh item shows zero versions", translate("pvCount", { count: 0 }));
    await expectOnScreen("the empty state is stated", translate("pvEmpty"));
    await expectOnScreen("the adapter hint is stated", translate("pvHint"));
    await expectOnScreen("generating a version is not publishing", translate("pvNotPublishing"));

    // Choosing a target must show that platform's own adapter facts, budgets included.
    await chooseTarget(withTitle.platform);
    await expectOnScreen("adapter facts", translate("pvAdapterFacts", { platform: withTitle.platform }));
    const budget = platformTextLimitMessage(withTitle);
    await expectOnScreen("the text budget says who enforces it", translate(budget.key, budget.values));

    await clickButton(translate("pvDeriveAction"));
    await waitOnScreen(translate("pvDerived", { platform: withTitle.platform }));
    await expectOnScreen("the count follows the server", translate("pvCount", { count: 1 }));
    await expectOnScreen("the source badge reads derived", translate(platformVersionSourceLabelKeys.derived));
    const stored = await versions(id);
    step("the server stored one version", stored.versions.length === 1, stored.versions.length);
    const derived = stored.versions[0];
    if (!derived) throw new Error("the derived version is missing on the server");
    step("the stored source is derived", derived.source === "derived", derived.source);
    step(
      "the stored fingerprint is the base's",
      derived.baseFingerprint === stored.base.fingerprint,
      derived.baseFingerprint,
    );
    // Editing saves what the author wrote and marks the version edited - it never re-derives.
    const marker = `ui smoke edited body ${timestamp}`;
    await clickButton(translate("pvEdit"));
    const bodyField = dialog.getByLabel(translate("pvVersionBody"));
    step("the editor opens on the stored text", (await bodyField.inputValue()) === derived.body, derived.body.length);
    await bodyField.fill(marker);
    await clickButton(translate("pvSave"));
    await waitOnScreen(translate("pvSaved", { platform: withTitle.platform }));
    await expectOnScreen("the source badge reads edited", translate(platformVersionSourceLabelKeys.edited));
    await expectOnScreen("the edited text is on screen", marker);
    const edited = (await versions(id)).versions[0];
    step("the server stored the edited body", edited?.body === marker, edited?.body.length);
    step("the server stored source edited", edited?.source === "edited", edited?.source);
    step("editing did not re-derive the fingerprint", edited?.baseFingerprint === stored.base.fingerprint);

    // Deleting asks first, then drops the version the server holds.
    await clickButton(translate("pvDelete"));
    await expectOnScreen("deleting asks first", translate("pvDeleteConfirm"));
    await clickButton(translate("pvDelete"));
    await waitOnScreen(translate("pvDeleted", { platform: withTitle.platform }));
    await expectOnScreen("the empty state is back", translate("pvEmpty"));
    step("the server dropped the version", (await versions(id)).versions.length === 0);

    // A platform with no title field: the adapter records that no title was offered, the panel says
    // so, and its editor has no title input - a save must not invent one (P2-07-03).
    await chooseTarget(withoutTitle.platform);
    await clickButton(translate("pvDeriveAction"));
    await waitOnScreen(translate("pvDerived", { platform: withoutTitle.platform }));
    await expectOnScreen("a platform without a title field says so", translate("pvNoTitleForPlatform"));
    const noTitleStored = (await versions(id)).versions.find(
      (version) => version.platform === withoutTitle.platform,
    );
    step("no title was invented for it", noTitleStored?.title === "", noTitleStored?.title.length);
    await clickButton(translate("pvEdit"));
    step("its editor offers no title input", (await dialog.getByLabel(translate("pvVersionTitle")).count()) === 0);
    await clickButton(translate("pvDelete"));
    await clickButton(translate("pvDelete"));
    await waitOnScreen(translate("pvDeleted", { platform: withoutTitle.platform }));
    step("the server kept nothing", (await versions(id)).versions.length === 0);

    const publishRecordsAfter = (await json<{ ok: boolean; data: unknown[] }>("/api/publish-records")).data.length;
    step("the panel wrote no publish record", publishRecordsAfter === publishRecordsBefore, publishRecordsAfter);
    step("the content status is untouched", (await json<ContentResponse>(`/api/content/${id}`)).data.status === "ready");
    step("the page raised no error", pageErrors.length === 0, pageErrors);
  } finally {
    await browser.close();
  }

  // The smoke item is deleted again, so a run leaves the isolated database as it found it.
  try {
    await json(`/api/content/${id}`, { method: "DELETE" });
  } catch (error) {
    console.error(`could not delete the smoke item ${id}: ${String(error)}`);
  }

  if (failures.length) {
    console.error(`FAILED ${failures.length}: ${failures.join(" | ")}`);
    process.exitCode = 1;
  } else {
    console.log(
      JSON.stringify(
        {
          ok: true,
          locale,
          baseUrl,
          contentItemId: id,
          platforms: { withTitle: withTitle.platform, withoutTitle: withoutTitle.platform },
          publishRecordsBefore,
        },
        null,
        2,
      ),
    );
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
