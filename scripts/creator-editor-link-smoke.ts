import { chromium, type Page } from "playwright";
import { articleEditorHref, articleEditorParam } from "../src/lib/editor-link";
import { localeResources, normalizeLocale } from "../src/lib/locale-resources";
import type { LocaleDictionary, TranslationKey } from "../src/lib/locale-resources";

/**
 * Dev-only smoke check for P5-C1 (generation -> editor): opens the article editor through the deep link
 * the generators publish, in a real browser, against a running `next dev` / `next start`.
 *
 * What this pins is the part unit tests cannot see - that `/{locale}/creation/articles?edit=<id>` really
 * opens the editor on that item, that the same entry reached by *clicking* from the content library and by
 * going *forward* through history opens it too (both mount the workspace with the parameter already in the
 * URL, which is where the entry used to be dropped), that leaving it drops the parameter so a reload shows
 * the list, and that an id which is gone lands on the workspace's own message instead of a blank screen.
 * What unit tests own is the URL contract itself (`src/lib/editor-link.test.ts`) and the response it reads
 * (`src/app/api/content/[id]/route.test.ts`).
 *
 * Not covered here, by design: the click that *produces* the link. Both generators that carry it call a
 * real model (`/api/ai-writing/generate`, `/api/content/generate`), which is not something a check run
 * on an arbitrary machine may spend. The link's shape is verified by navigating to exactly the href the
 * wizard builds (`articleEditorHref`), which is the same expression its JSX uses.
 *
 * Everything it creates, it deletes. Usage: tsx scripts/creator-editor-link-smoke.ts [baseUrl] [locale]
 */
const baseUrl = (process.argv[2] ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const locale = normalizeLocale(process.argv[3]);

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };
type ContentItemShape = { id: string; title: string };

const title = `P5-C1 smoke ${Date.now()}`;

/** The visible text of a page, flattened - enough to tell "the list" from "the editor" in a failure. */
async function excerpt(page: Page) {
  return (await page.locator("body").innerText()).replace(/\s+/g, " ").trim().slice(0, 240);
}

/** Waits for the editor to show the item it was asked to open, and names the step that failed when it does not. */
async function waitForEditor(page: Page, marker: string, where: string, pageErrors: string[] = []) {
  await page
    .waitForFunction((text) => document.body.innerText.includes(text), marker, { timeout: 30_000 })
    .catch(() => {
      throw new Error(
        `The editor never opened ${where} (looking for "${marker}"). Page errors: ${pageErrors.join(" | ") || "none"}`,
      );
    });
}

async function main() {
  const browser = await chromium.launch();
  const dictionary: LocaleDictionary = localeResources[locale];
  const t = (key: TranslationKey) => dictionary[key] ?? key;
  const itemUrl = `${baseUrl}/api/content`;
  let itemId = "";

  try {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    // The fixture is created through the app's own API, so the deep link opens something the app wrote.
    const created = (await (
      await page.request.post(itemUrl, { data: { title, type: "article" } })
    ).json()) as ApiResponse<ContentItemShape>;
    if (!created.ok) throw new Error(`POST /api/content did not answer ok: ${created.error}`);
    itemId = created.data.id;

    const shortId = itemId.slice(0, 8).toUpperCase();
    const editorMarker = `${t("aeArticleId")}: ${shortId}`;

    const response = await page.goto(`${baseUrl}${articleEditorHref(locale, itemId)}`, { waitUntil: "domcontentloaded" });
    if (!response || !response.ok()) throw new Error(`Page request failed: ${response?.status()}`);
    await waitForEditor(page, editorMarker, "on the deep link the generators publish", pageErrors);
    if (!page.url().includes(`${articleEditorParam}=`)) {
      throw new Error(`The editor opened but the URL kept no ${articleEditorParam} entry: ${page.url()}`);
    }

    const titleInput = page.getByPlaceholder(t("arFieldTitlePlaceholder"));
    if ((await titleInput.inputValue()) !== title) {
      throw new Error(`The editor opened on the wrong article: ${await titleInput.inputValue()}`);
    }

    // CI-ARTICLE-NAV-01: the same entry reached by *clicking* from the content library, and the history
    // moves around it. A click mounts the workspace with the parameter already in the URL - the case the
    // `goto` above never exercises - and going forward through history re-mounts it the same way. The
    // marker on `window` proves the click stayed client-side: without it this check would also pass if the
    // library's link ever became a full page load, which is not the hand-off it is meant to pin.
    await page.goto(`${baseUrl}/${locale}/content/library`, { waitUntil: "domcontentloaded" });
    await page.getByPlaceholder(t("contentSearchPlaceholder")).fill(title);
    await page.getByRole("button").filter({ hasText: title }).first().click();
    const editorLink = page.getByRole("link", { name: t("awOpenEditor") });
    const libraryHref = await editorLink.getAttribute("href", { timeout: 20_000 });
    if (libraryHref !== articleEditorHref(locale, itemId)) {
      throw new Error(`The library offers ${libraryHref}, expected ${articleEditorHref(locale, itemId)}`);
    }
    await page.evaluate(() => {
      (window as unknown as { softNavigationMarker?: boolean }).softNavigationMarker = true;
    });
    await editorLink.click();
    await page.waitForURL((url) => url.searchParams.get(articleEditorParam) === itemId, { timeout: 30_000 });
    const stayedClientSide = await page.evaluate(
      () => Boolean((window as unknown as { softNavigationMarker?: boolean }).softNavigationMarker),
    );
    if (!stayedClientSide) throw new Error("Clicking the library's editor link reloaded the document");
    await waitForEditor(page, editorMarker, "after clicking the library link");
    if ((await page.getByPlaceholder(t("arFieldTitlePlaceholder")).inputValue()) !== title) {
      throw new Error("The editor opened on the wrong article after clicking the library link");
    }

    // Back leaves the route, forward re-mounts the workspace on the same `?edit=` URL - the other place
    // this entry is reached by a client-side navigation, so it has to open the editor, not the bare list.
    await page.goBack({ timeout: 15_000 }).catch(() => undefined);
    await page
      .waitForFunction(() => window.location.pathname.endsWith("/content/library"), undefined, { timeout: 15_000 })
      .catch(() => {
        throw new Error(`Going back from the editor did not return to the library: ${page.url()}`);
      });
    await page.goForward({ timeout: 15_000 }).catch(() => undefined);
    await page
      .waitForFunction(
        // The predicate is serialized into the page, so it may only use its own arguments: a
        // module-level constant (like `articleEditorParam`) is not defined there.
        ([param, marker]) =>
          window.location.search.includes(`${param}=`) && document.body.innerText.includes(marker),
        [articleEditorParam, editorMarker],
        { timeout: 30_000 },
      )
      .catch(() => {
        throw new Error(`Going forward to ${articleEditorHref(locale, itemId)} did not reopen the editor: ${page.url()}`);
      });

    // Leaving the editor is also leaving the link: the list must be back, without the entry parameter,
    // and a reload must not reopen what was just closed.
    await page.getByRole("button", { name: t("aeBack") }).click();
    const leftTheEditor = await page
      .waitForFunction(() => !window.location.search.includes("edit="), undefined, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!leftTheEditor) {
      throw new Error(
        `Closing the editor left the deep link in the URL: ${page.url()} - screen says: ${await excerpt(page)}`,
      );
    }
    await page.getByRole("button", { name: t("arNew") }).waitFor({ timeout: 15_000 });

    await page.reload({ waitUntil: "domcontentloaded" });
    const reopened = await page
      .waitForFunction((marker) => document.body.innerText.includes(marker), editorMarker, { timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    if (reopened) throw new Error("A reload after leaving the editor reopened it");

    // A link whose item is gone: the workspace says so and stays usable.
    const removedId = itemId;
    const deleted = await page.request.delete(`${itemUrl}/${itemId}`);
    if (!deleted.ok()) throw new Error(`DELETE /api/content/${itemId} failed: ${deleted.status()}`);
    itemId = "";

    await page.goto(`${baseUrl}${articleEditorHref(locale, removedId)}`, { waitUntil: "domcontentloaded" });
    const noticeShown = await page
      .waitForFunction((text) => document.body.innerText.includes(text), t("arEditorOpenFailed"), { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    const listShown = await page
      .getByRole("button", { name: t("arNew") })
      .isVisible()
      .catch(() => false);
    if (!noticeShown || !listShown) {
      throw new Error(
        `An unopenable link did not report itself (notice ${noticeShown}, list ${listShown}). Page errors: ${
          pageErrors.join(" | ") || "none"
        }`,
      );
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          locale,
          baseUrl,
          link: articleEditorHref(locale, "CONTENT_ID"),
          opened: editorMarker,
          titleMatched: true,
          libraryClickOpenedTheEditor: true,
          historyForwardReopenedTheEditor: true,
          exitDroppedTheParameter: true,
          reloadStayedOnTheList: true,
          unopenableLinkReported: true,
          pageErrors,
        },
        null,
        2,
      ),
    );
  } finally {
    if (itemId) {
      await fetch(`${itemUrl}/${itemId}`, { method: "DELETE" }).catch(() => undefined);
    }
    await browser.close();
  }
}

void main();
