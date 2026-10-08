import { chromium } from "playwright";

/**
 * Dev-only smoke check for the whiteboard (白板) integration points:
 *  - toolbar re-renders (app menu toggle, element creation, selection) without
 *    React duplicate-key warnings
 *  - "export to content library" opens an in-app dialog (no `window.prompt`,
 *    which Electron does not implement) and posts the serialised board
 *  - the POST /api/content/whiteboard round trip works and the created draft is
 *    removed again
 * Requires `next dev` / `next start` on the given base URL.
 *
 * Usage: tsx scripts/whiteboard-smoke.ts [baseUrl] [locale]
 */
const baseUrl = (process.argv[2] ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const locale = process.argv[3] ?? "zh-cn";
const MARKDOWN_SOURCE = "# SmokeRoot\n\n- Child A\n\n- Child B";
const MIND_ROOT = "SmokeRoot";
const EXPORT_TITLE = "smoke-whiteboard-export";

type ConsoleEntry = { type: string; text: string };
type NativeDialog = { type: string; message: string };
type ExportPayload = { title?: string; body?: string };

async function main() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const consoleEntries: ConsoleEntry[] = [];
    const pageErrors: string[] = [];
    const nativeDialogs: NativeDialog[] = [];
    page.on("console", (message) => {
      const type = message.type();
      if (type === "error" || type === "warning") {
        consoleEntries.push({ type, text: message.text() });
      }
    });
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    // `window.prompt`/`alert`/`confirm` never render in Electron; recording them
    // proves the export flow no longer depends on them.
    page.on("dialog", async (dialog) => {
      nativeDialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.dismiss();
    });

    const response = await page.goto(`${baseUrl}/${locale}/whiteboard`, { waitUntil: "networkidle" });
    if (!response || !response.ok()) {
      throw new Error(`Page request failed: ${response?.status()}`);
    }

    const toolbar = page.locator(".app-toolbar");
    await toolbar.waitFor({ timeout: 30_000 });
    const readButtonTitles = () =>
      toolbar
        .locator("button")
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") ?? node.textContent ?? ""));
    const initialButtonTitles = await readButtonTitles();

    // 1. Fresh board: the export dialog reports the empty board and blocks submit.
    await toolbar.locator('[data-testid="export-to-library-button"]').click();
    await page.locator('[data-testid="export-to-library-empty"]').waitFor({ timeout: 10_000 });
    const emptyBoardSubmitDisabled = await page
      .locator('[data-testid="export-to-library-submit"]')
      .isDisabled();
    await page.locator('[data-testid="export-to-library-cancel"]').click();
    await page.locator('[data-testid="export-to-library-title"]').waitFor({ state: "detached", timeout: 10_000 });

    // 2. The AI dialog renders its (localised) form. No AI request is made.
    await toolbar.locator('[data-testid="ai-generate-button"]').click();
    const aiTopicInput = page.locator('[data-testid="ai-generate-topic"]');
    await aiTopicInput.waitFor({ timeout: 10_000 });
    const aiDialog = {
      placeholder: (await aiTopicInput.getAttribute("placeholder")) ?? "",
      submitLabel:
        (await page.locator('[data-testid="ai-generate-submit"]').textContent())?.trim() ?? "",
      description:
        (await page.locator(".ai-generate-dialog .ttd-dialog-desc").textContent())?.trim() ?? "",
    };
    await page.locator(".Dialog-overlay").click({ position: { x: 5, y: 5 } });
    await aiTopicInput.waitFor({ state: "detached", timeout: 10_000 });

    // Toggle the app menu twice: duplicate keys only warn while reconciling a re-render.
    const menuTrigger = toolbar.locator("button").first();
    await menuTrigger.click();
    await page.waitForTimeout(400);
    const menuItemsVisible = await page.locator(".menu").count();
    await menuTrigger.click();
    await page.waitForTimeout(400);

    const boardSurface = await page.locator(".plait-board-container, .drawnix").count();
    const boardBox = await page.locator(".plait-board-container").first().boundingBox();
    if (!boardBox) {
      throw new Error("Board container has no layout box");
    }
    const focusPoint = { x: boardBox.x + boardBox.width * 0.6, y: boardBox.y + boardBox.height * 0.6 };

    // Seed deterministic content through the app's own Markdown → Drawnix flow:
    // a mind map with a root and two children.
    const countGroups = () => page.locator(".plait-board-container svg g").count();
    const groupsBeforeCreate = await countGroups();
    await page.locator('[data-testid="extra-tools-button"]').click();
    await page.locator('[data-testid="markdown-to-drawnix-button"]').click();
    const markdownInput = page.locator(".ttd-dialog-input");
    await markdownInput.waitFor({ timeout: 10_000 });
    await markdownInput.fill(MARKDOWN_SOURCE);
    await page.waitForTimeout(800);
    await page.locator(".ttd-dialog-panel-button").last().click();
    await page.waitForTimeout(800);
    const groupsAfterCreate = await countGroups();

    // Select everything so the duplicate/delete buttons join the toolbar children.
    await page.mouse.move(focusPoint.x, focusPoint.y);
    await page.keyboard.press("v");
    await page.keyboard.press("Control+a");
    await page.waitForTimeout(500);
    const selectedButtonTitles = await readButtonTitles();

    // 2. Export the board through the in-app dialog; the POST is intercepted so the
    //    run stays read-only for the content library.
    const captured: { payload: ExportPayload | null } = { payload: null };
    await page.route("**/api/content/whiteboard", async (route) => {
      captured.payload = (route.request().postDataJSON() ?? null) as ExportPayload | null;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { item: { id: "smoke" } } }),
      });
    });
    await toolbar.locator('[data-testid="export-to-library-button"]').click();
    const titleInput = page.locator('[data-testid="export-to-library-title"]');
    await titleInput.waitFor({ timeout: 10_000 });
    const previewText = (await page.locator('[data-testid="export-to-library-preview"]').textContent()) ?? "";
    await titleInput.fill(EXPORT_TITLE);
    await page.locator('[data-testid="export-to-library-submit"]').click();
    await titleInput.waitFor({ state: "detached", timeout: 10_000 });
    const toastVisible = (await page.locator(".drawnix-toast--success").count()) > 0;
    await page.unroute("**/api/content/whiteboard");

    const previewIncludesRoot = previewText.includes(MIND_ROOT);
    const previewStartsWithRoot = previewText.trimStart().startsWith(`# ${MIND_ROOT}`);
    const exportedBodyHasRoot = (captured.payload?.body ?? "").includes(MIND_ROOT);
    // Counts instead of the raw body: the report must survive console codepage
    // mojibake when the smoke runs from a non UTF-8 shell.
    const bodyLines = (captured.payload?.body ?? "").split("\n");
    const bodyStructure = {
      lineCount: bodyLines.length,
      headingCount: bodyLines.filter((line) => /^#{1,6} /.test(line)).length,
      bulletCount: bodyLines.filter((line) => line.startsWith("- ")).length,
    };

    // 3. Real API round trip: create a draft from the exported body, then delete it.
    const createResponse = await page.request.post(`${baseUrl}/api/content/whiteboard`, {
      data: { title: `${EXPORT_TITLE}-api`, body: captured.payload?.body ?? "" },
    });
    const createJson = (await createResponse.json().catch(() => null)) as
      | { data?: { item?: { id?: string } } }
      | null;
    const createdId = createJson?.data?.item?.id ?? null;
    let deleteStatus: number | null = null;
    let deleted = false;
    if (createdId) {
      const deleteResponse = await page.request.delete(`${baseUrl}/api/content/${createdId}`);
      deleteStatus = deleteResponse.status();
      const deleteJson = (await deleteResponse.json().catch(() => null)) as
        | { data?: { deleted?: boolean } }
        | null;
      deleted = deleteJson?.data?.deleted === true;
    }

    const duplicateKeyEntries = consoleEntries.filter((entry) => entry.text.includes("same key"));
    const aiDialogOk =
      aiDialog.placeholder.length > 0 &&
      aiDialog.submitLabel.length > 0 &&
      aiDialog.description.length > 0;
    const exportFlowOk =
      captured.payload !== null &&
      captured.payload.title === EXPORT_TITLE &&
      exportedBodyHasRoot &&
      previewIncludesRoot &&
      previewStartsWithRoot &&
      bodyStructure.headingCount >= 2 &&
      bodyStructure.bulletCount === 0 &&
      toastVisible;

    console.log(
      JSON.stringify(
        {
          ok:
            duplicateKeyEntries.length === 0 &&
            pageErrors.length === 0 &&
            nativeDialogs.length === 0 &&
            emptyBoardSubmitDisabled &&
            aiDialogOk &&
            exportFlowOk &&
            deleted,
          locale,
          buttonCount: initialButtonTitles.length,
          initialButtonTitles,
          selectedButtonTitles,
          menuItemsVisible,
          boardSurface,
          groups: { beforeCreate: groupsBeforeCreate, afterCreate: groupsAfterCreate },
          aiDialog,
          exportToLibrary: {
            emptyBoardSubmitDisabled,
            previewIncludesRoot,
            previewStartsWithRoot,
            postedTitle: captured.payload?.title ?? null,
            bodyStructure,
            exportedBodyHasRoot,
            toastVisible,
          },
          apiRoundTrip: {
            createStatus: createResponse.status(),
            createdId,
            deleteStatus,
            deleted,
          },
          nativeDialogs,
          duplicateKeyEntries,
          otherConsoleEntries: consoleEntries,
          pageErrors,
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
