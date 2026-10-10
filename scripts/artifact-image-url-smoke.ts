import { chromium, type Page } from "playwright";
import { articleEditorHref, articleEditorParam } from "../src/lib/editor-link";
import { localizedPath } from "../src/lib/i18n-config";
import { localeResources, normalizeLocale } from "../src/lib/locale-resources";
import type { LocaleDictionary, TranslationKey } from "../src/lib/locale-resources";

/**
 * Dev-only smoke check for P1 card 1 / A02 (one client image-URL resolver, six call sites), against
 * a running `next dev` / `next start`.
 *
 * The string contract is unit-tested (`src/lib/artifact-image-url.test.ts`) and the routes it points
 * at have their own tests. What only a browser can show is that the *pages* paint the images those
 * URLs name: a resolver could answer the perfect string and still be wired into the wrong element,
 * and `naturalWidth > 0` is the difference between "an `<img>` with the right attribute" and "the
 * artifacts route served those bytes". So every claim below is about the painted result.
 *
 * Covered: the content library card cover, the article editor's cover preview, and the editor's
 * insert-image path (toolbar -> "from library" tab -> pick), whose DOM result is checked without
 * saving, so this check writes no content body. Not covered, by design: the publish flow (out of
 * scope for this card), and the video composer / AI-writing thumbnails, which reach the same
 * resolver through the same import.
 *
 * Everything it creates, it deletes. Usage: tsx scripts/artifact-image-url-smoke.ts [baseUrl] [locale]
 */
const baseUrl = (process.argv[2] ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const locale = normalizeLocale(process.argv[3]);

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };
type UploadedImage = { fileName: string; url: string };
type ContentItemShape = { id: string; title: string };

/** The smallest valid PNG - enough for the upload route to store a file and for a browser to paint it. */
const PNG_ONE_PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

/** Waits until the page holds an `<img>` with exactly this `src` *and* the browser painted bytes for it. */
async function painted(page: Page, src: string) {
  return page
    .waitForFunction(
      (value) => {
        const image = Array.from(document.images).find((entry) => entry.getAttribute("src") === value);
        return Boolean(image && image.complete && image.naturalWidth > 0);
      },
      src,
      // Generous on purpose: the first visit in dev compiles the route before it renders anything.
      { timeout: 60_000 },
    )
    .then(() => true)
    .catch(() => false);
}

async function main() {
  const browser = await chromium.launch();
  const dictionary: LocaleDictionary = localeResources[locale];
  const t = (key: TranslationKey) => dictionary[key] ?? key;
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  const title = `P1-C1 A02 smoke ${Date.now()}`;
  let itemId = "";
  let fileName = "";

  try {
    // The upload route is one of the call sites this card de-duplicated, so the fixture starts from
    // the URL the app itself answers with rather than from a string typed into this script.
    const uploaded = (await (
      await page.request.post(`${baseUrl}/api/images/upload`, {
        multipart: { file: { name: "smoke-cover.png", mimeType: "image/png", buffer: PNG_ONE_PIXEL } },
      })
    ).json()) as ApiResponse<UploadedImage>;
    if (!uploaded.ok) throw new Error(`POST /api/images/upload did not answer ok: ${uploaded.error}`);
    fileName = uploaded.data.fileName;
    const expected = `/api/agent/artifacts?file=${encodeURIComponent(fileName)}`;
    if (uploaded.data.url !== expected) {
      throw new Error(`The upload answered "${uploaded.data.url}", the stored shape is "${expected}"`);
    }

    const created = (await (
      await page.request.post(`${baseUrl}/api/content`, {
        data: { title, type: "article", images: [fileName] },
      })
    ).json()) as ApiResponse<ContentItemShape>;
    if (!created.ok) throw new Error(`POST /api/content did not answer ok: ${created.error}`);
    itemId = created.data.id;

    // 1. `/{locale}/content/library` - the newest item is on page one, and its cover has to load.
    await page.goto(`${baseUrl}${localizedPath(locale, "/content/library")}`, { waitUntil: "domcontentloaded" });
    if (!(await painted(page, expected))) {
      throw new Error(
        `The content library never painted ${expected}. Page errors: ${pageErrors.join(" | ") || "none"}`,
      );
    }

    // 2. the article editor - the same file as the item's cover, through the editor's own call site.
    await page.goto(`${baseUrl}${articleEditorHref(locale, itemId)}`, { waitUntil: "domcontentloaded" });
    if (!page.url().includes(`${articleEditorParam}=`)) {
      throw new Error(`The editor did not open through the deep link: ${page.url()}`);
    }
    if (!(await painted(page, expected))) {
      throw new Error(
        `The editor cover never painted ${expected}. Page errors: ${pageErrors.join(" | ") || "none"}`,
      );
    }

    // 3. the insert-image path: what the editor puts in the body is the URL the resolver answers,
    //    and the body's copy of it loads too - the same string `article-editor` persists on save.
    await page.getByRole("button", { name: "Insert image" }).click();
    await page.getByRole("button", { name: t("aimgFromLibrary") }).click();
    const tile = page.locator(`img[alt="${fileName}"]`);
    await tile.waitFor({ timeout: 30_000 });
    await tile.click();
    const inserted = await page
      .waitForFunction(
        (value) => {
          const editor = document.querySelector('div[contenteditable="true"]');
          if (!editor) return false;
          const image = Array.from(editor.querySelectorAll("img")).find(
            (entry) => entry.getAttribute("src") === value,
          ) as HTMLImageElement | undefined;
          return Boolean(image && image.complete && image.naturalWidth > 0);
        },
        expected,
        { timeout: 30_000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!inserted) {
      throw new Error(`Inserting the library image did not put a painted ${expected} into the body`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          locale,
          baseUrl,
          imageUrl: expected,
          uploadAnsweredTheStoredShape: true,
          contentLibraryPaintedTheCover: true,
          editorCoverPaintedTheSameFile: true,
          insertImagePutItInTheBody: true,
          pageErrors,
        },
        null,
        2,
      ),
    );
  } finally {
    if (itemId) {
      await fetch(`${baseUrl}/api/content/${itemId}`, { method: "DELETE" }).catch(() => undefined);
    }
    if (fileName) {
      await fetch(`${baseUrl}/api/images`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileNames: [fileName] }),
      }).catch(() => undefined);
    }
    await browser.close();
  }
}

void main();
