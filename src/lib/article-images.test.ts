import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `lib/article-images.ts` - the article image strategy (batch P3-B-2 of `docs/generate-migration-p3.md`).
 *
 * The second surface of batch B, and the second one that needed no migration: the file walks three
 * sources (`product` -> `web` -> `ai`) and each step already speaks to a domain service - `fs.copyFile`
 * for a stored photo, `fetchArticleText()` from `lib/scraper.ts` for `og:image`, and `generateImageFile()`
 * from `lib/agent/image-generation.ts`, which *is* the runtime boundary (D-P3-2). So this batch freezes
 * the strategy itself, because nothing in the suite watched it: the only two callers
 * (`api/ai-writing/generate`, `api/content/generate`) both fixture `imageStrategy: "product"`, and
 * `src/lib/article-images.test.ts` did not exist - neither the `web` stage, nor the `ai` stage, nor
 * `maxGeneratedArticleImages` had a single assertion behind it.
 *
 * That gap matters *now* rather than later: the AI stage is the one P3-B-3 touches when it cuts
 * `image-generation.ts -> compat.ts`, and the only thing between that cut and the article generator is
 * the `catch { break }` pinned below.
 *
 * Three layers, in the order the module is read:
 *
 *  1. **The strategy** - the gating per source, `target` as an upper bound, dedupe, the order the sources
 *     are spent in, `maxGeneratedArticleImages` as a per-run budget (not a target), and each stage being
 *     skipped entirely once `target` is reached.
 *  2. **The artifacts** - the two provenance families are pinned by name and by bytes (`writing-*` is a
 *     copy of a stored product photo, `agent-image-*` is a generation), and a remote `og:image` stays the
 *     remote URL it is, writing no file at all.
 *  3. **Best effort** - a failing AI stage may not fail the article, and may not lose the images the
 *     earlier stages already collected.
 *
 * The chain under test is the real one - `resolveArticleImages`, the scraper, the domain service, the
 * runtime, the registry, the router, the key pool, the provider adapter - and only the *transport* is
 * stubbed. Nothing here asserts that a mock was called.
 *
 * `@/lib/ai`, `@/lib/ai/generate` and `@/lib/ai/compat` are mocked with throwing factories: this is the
 * article *image* path, so a surviving legacy-facade import anywhere under it fails the whole file instead
 * of a packaged build. The compat factory is the one P3-B-3 added - the shim is no longer reachable from
 * this path at all, so the factory costs nothing and turns the cut into an assertion.
 */
vi.mock("@/lib/ai", () => {
  throw new Error("lib/article-images must not import the legacy facade (@/lib/ai)");
});
vi.mock("@/lib/ai/generate", () => {
  throw new Error("lib/article-images must not import the legacy facade (@/lib/ai/generate)");
});
vi.mock("@/lib/ai/compat", () => {
  throw new Error("lib/article-images must not reach the compat shim (@/lib/ai/compat)");
});

/**
 * The harness pins the temp database and the keyless env before anything that reads them loads
 * (`src/test/route-harness.ts`), so it has to be the first `await` here.
 */
const { jsonResponse, prepareImageModel, resetRuntime, routeTestDataDir, stubFetch, unavailable, unauthorized } =
  await import("@/test/route-harness");
const { maxGeneratedArticleImages, resolveArticleImages } = await import("./article-images");
const { updateLocalAgentSettings } = await import("@/db/repositories/settings");

/** The temp data root's artifacts directory, which is the only directory these cases let files land in. */
const artifactsDir = path.join(routeTestDataDir, "artifacts");
/** Where a product photo really lives: `web-data/product-images` in a running install. */
const sourceDir = path.join(routeTestDataDir, "product-images");

const articleTitle = "为什么复购率高的是这口锅";

type ResolveInput = Parameters<typeof resolveArticleImages>[0];

/** The strategy under test with everything else defaulted, so each case names only what it changes. */
const resolve = (input: Partial<ResolveInput>) =>
  resolveArticleImages({
    strategy: "product",
    target: 1,
    productImagePaths: [],
    sourceUrls: [],
    title: articleTitle,
    ...input,
  });

/** A stored product photo, written for real: the copy that follows is a real `fs.copyFile`. */
async function source(name: string, bytes = `bytes-of-${name}`) {
  await fs.mkdir(sourceDir, { recursive: true });
  const filePath = path.join(sourceDir, name);
  await fs.writeFile(filePath, bytes);
  return filePath;
}

/** The whole artifacts directory, sorted - a case can compare it against the images it got back. */
async function artifacts() {
  await fs.mkdir(artifactsDir, { recursive: true });
  return (await fs.readdir(artifactsDir)).sort();
}

async function clearArtifacts() {
  for (const name of await artifacts()) {
    await fs.rm(path.join(artifactsDir, name), { force: true });
  }
}

const bytesOf = (imagePath: string) => fs.readFile(imagePath, "utf-8");

type Call = { url: string; init?: RequestInit };

/** The one channel an image may come from; a chat call on this path would be a routing bug. */
const generationCalls = (calls: Call[]) => calls.filter((call) => call.url.includes("/images/generations"));

const imageBodyOf = (call: Call) =>
  JSON.parse(String(call?.init?.body)) as { model?: string; prompt?: string; size?: string };

/**
 * A page the way `fetchArticleText()` reads it: HTML on the wire, `og:image` in the head when the page
 * has one. The harness only answers JSON, and this branch is the only place in the app that reads HTML,
 * so the helper lives with the case that needs it.
 */
function htmlResponse(html: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "text/html" }),
    text: async () => html,
    json: async () => ({}),
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

const page = (imageUrl?: string) =>
  `<html><head>${
    imageUrl ? `<meta property="og:image" content="${imageUrl}">` : ""
  }</head><body><article>article body</article></body></html>`;

/** One source page per url, each naming its own `og:image`, so a case can count what was really read. */
const pageRoutes = (urls: string[]) =>
  urls.map((url) => ({
    match: (target: string) => target === url,
    respond: () => htmlResponse(page(`https://cdn.example.com/${url.split("/").pop()}.png`)),
  }));

/** The bytes are recognisable on purpose: "the file on disk is the decoded answer" is one assertion. */
const pngBytes = "fake-png-bytes";
const encoded = (value: string) => Buffer.from(value).toString("base64");

const openAIImageCatalog = () => jsonResponse({ data: [{ id: "gpt-image-1" }] });
const geminiImageCatalog = () =>
  jsonResponse({
    models: [
      {
        name: "models/gemini-2.5-flash-image",
        baseModelId: "gemini-2.5-flash-image",
        supportedGenerationMethods: ["generateContent"],
      },
    ],
  });

/** Base64 payloads: the OpenAI shape the adapter decodes without a second request. */
const openAIImageReply = (bytes = pngBytes) => jsonResponse({ data: [{ b64_json: encoded(bytes) }] });

/** The Gemini shape, which this path must never reach while the settings still name OpenAI. */
const geminiImageReply = () =>
  jsonResponse({
    candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: encoded("gemini-bytes") } }] } }],
  });

/** The two calls the OpenAI image path makes: the fixture's catalog read, then one generation. */
const openAIRoutes = (reply: () => Response) => [
  { match: (url: string) => url.endsWith("/models"), respond: openAIImageCatalog },
  { match: (url: string) => url.includes("/images/generations"), respond: reply },
];

/** The usual fixture: one credential, one callable image model, the image capability default. */
const prepareOpenAIImage = () => prepareImageModel("openai", "gpt-image-1", "sk-stub-openai");

describe("resolveArticleImages on aiRuntime", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await resetRuntime();
    // The two settings this path reads are restored here, because a case may pin the other provider
    // and nothing else resets them.
    await updateLocalAgentSettings({ imageProvider: "openai", openAIImageSize: "1024x1024" });
    await clearArtifacts();
    await fs.rm(sourceDir, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /* ------------------------------------------------------------------ 1. the product stage */

  it("copies a product photo into artifacts and leaves the source where the product keeps it", async () => {
    const sourcePath = await source("shot-pan.png");

    const images = await resolve({ productImagePaths: [sourcePath] });

    expect(images).toHaveLength(1);
    const [copy] = images;
    expect(path.dirname(copy)).toBe(artifactsDir);
    // The provenance is in the name: a copy of a stored photo is `writing-*`, never an AI file.
    expect(path.basename(copy)).toMatch(/^writing-\d+-[A-Za-z0-9_-]{8}\.png$/);
    // A copy, not a move: the bytes are in artifacts and the product photo is still where it was.
    expect(await bytesOf(copy)).toBe("bytes-of-shot-pan.png");
    await expect(fs.stat(sourcePath)).resolves.toBeTruthy();
    expect(await artifacts()).toEqual([path.basename(copy)]);
  });

  it("keeps the source extension, lower-cased, and falls back to .png when the path has none", async () => {
    const jpeg = await source("shot-lid.JPG");
    const extensionless = await source("shot-no-extension");

    const images = await resolve({ target: 2, productImagePaths: [jpeg, extensionless] });

    expect(images.map((image) => path.extname(image))).toEqual([".jpg", ".png"]);
  });

  it("skips a product photo that is not on disk and still copies the one that is", async () => {
    const missing = path.join(sourceDir, "never-written.png");
    const present = await source("shot-lid.png");

    const images = await resolve({ target: 3, productImagePaths: [missing, present] });

    expect(images).toHaveLength(1);
    expect(await bytesOf(images[0])).toBe("bytes-of-shot-lid.png");
  });

  it("ignores a blank entry instead of asking the filesystem about it", async () => {
    const present = await source("shot-pan.png");

    const images = await resolve({ target: 3, productImagePaths: ["", present] });

    expect(images).toHaveLength(1);
  });

  it("stops at target, in the order the caller selected the products", async () => {
    const photos = await Promise.all([source("shot-1.png"), source("shot-2.png"), source("shot-3.png")]);

    const images = await resolve({ target: 2, productImagePaths: photos });

    // Two files, and they are the *first two* photos - which the generated names cannot show.
    expect(await Promise.all(images.map(bytesOf))).toEqual(["bytes-of-shot-1.png", "bytes-of-shot-2.png"]);
    expect(await artifacts()).toEqual(images.map((image) => path.basename(image)).sort());
  });

  it("never reads a source page when the strategy is product only", async () => {
    const sourcePath = await source("shot-pan.png");
    const pageUrl = "https://news.example.com/pages/1";
    const calls = stubFetch(pageRoutes([pageUrl]));

    const images = await resolve({
      strategy: "product",
      target: 3,
      productImagePaths: [sourcePath],
      sourceUrls: [pageUrl],
    });

    expect(images).toHaveLength(1);
    // The page route exists and would have answered: it was not read because the strategy is a gate.
    expect(calls.filter((call) => call.url === pageUrl)).toHaveLength(0);
  });

  /* ------------------------------------------------------------------ 2. the web stage */

  it("stores the source page's og:image as the remote URL it is, and writes no file", async () => {
    const pageUrl = "https://news.example.com/pages/1";
    stubFetch(pageRoutes([pageUrl]));

    const images = await resolve({ strategy: "web", sourceUrls: [pageUrl] });

    // The URL is handed on verbatim: no download, no copy, nothing in artifacts.
    expect(images).toEqual(["https://cdn.example.com/1.png"]);
    expect(await artifacts()).toEqual([]);
  });

  it("ignores the product photos when the strategy is web only", async () => {
    const sourcePath = await source("shot-pan.png");
    const pageUrl = "https://news.example.com/pages/1";
    stubFetch(pageRoutes([pageUrl]));

    const images = await resolve({ strategy: "web", target: 3, productImagePaths: [sourcePath], sourceUrls: [pageUrl] });

    expect(images).toEqual(["https://cdn.example.com/1.png"]);
    expect(await artifacts()).toEqual([]);
  });

  it("reads at most the first three source urls", async () => {
    const urls = [1, 2, 3, 4, 5].map((index) => `https://news.example.com/pages/${index}`);
    const calls = stubFetch(pageRoutes(urls));

    const images = await resolve({ strategy: "web", target: 6, sourceUrls: urls });

    // Three, although the target asked for six and every page could have answered.
    expect(images).toEqual([
      "https://cdn.example.com/1.png",
      "https://cdn.example.com/2.png",
      "https://cdn.example.com/3.png",
    ]);
    // Not "ignored after the third": the fourth url was never fetched.
    expect(calls.map((call) => call.url)).toEqual(urls.slice(0, 3));
  });

  it("keeps going after a page that is down or carries no og:image", async () => {
    const dead = "https://news.example.com/pages/dead";
    const bare = "https://news.example.com/pages/bare";
    const good = "https://news.example.com/pages/good";
    const calls = stubFetch([
      { match: (target: string) => target === dead, respond: () => htmlResponse(page(), 503) },
      { match: (target: string) => target === bare, respond: () => htmlResponse(page()) },
      { match: (target: string) => target === good, respond: () => htmlResponse(page("https://cdn.example.com/og.png")) },
    ]);

    const images = await resolve({ strategy: "web", target: 3, sourceUrls: [dead, bare, good] });

    expect(images).toEqual(["https://cdn.example.com/og.png"]);
    // All three were tried: an ignored page does not end the loop.
    expect(calls).toHaveLength(3);
  });

  it("adds the same image only once", async () => {
    const urls = ["https://news.example.com/pages/a", "https://news.example.com/pages/b"];
    stubFetch(
      urls.map((url) => ({
        match: (target: string) => target === url,
        respond: () => htmlResponse(page("https://cdn.example.com/shared.png")),
      })),
    );

    const images = await resolve({ strategy: "web", target: 3, sourceUrls: urls });

    expect(images).toEqual(["https://cdn.example.com/shared.png"]);
  });

  /* ------------------------------------------------------------------ 3. the AI stage */

  it("generates the missing image, names the article in the prompt and reports nothing else", async () => {
    const calls = stubFetch(openAIRoutes(() => openAIImageReply()));
    await prepareOpenAIImage();

    const images = await resolve({ strategy: "ai" });

    expect(images).toHaveLength(1);
    const [generated] = images;
    expect(path.dirname(generated)).toBe(artifactsDir);
    // The other half of the provenance: this file is a generation, not a copy of a product photo.
    expect(path.basename(generated)).toMatch(/^agent-image-\d+-[A-Za-z0-9_-]{8}\.png$/);
    expect(await bytesOf(generated)).toBe(pngBytes);

    // One generation, with the runtime's model and the OpenAI-shaped size the setting holds.
    const generations = generationCalls(calls);
    expect(generations).toHaveLength(1);
    const wire = imageBodyOf(generations[0]);
    expect(wire.model).toBe("gpt-image-1");
    expect(wire.prompt).toContain(articleTitle);
    expect(wire.size).toBe("1024x1024");
    // The image comes from the image channel, never from a chat call.
    expect(calls.filter((call) => call.url.includes("/chat/completions"))).toHaveLength(0);
  });

  it("keeps the image provider pinned instead of falling over to the other one (G3)", async () => {
    const calls = stubFetch([
      { match: (target: string) => target.includes("/v1beta/models?"), respond: geminiImageCatalog },
      { match: (target: string) => target.includes(":generateContent"), respond: geminiImageReply },
    ]);
    // Gemini is configured *and* callable; the settings still name OpenAI as the image provider.
    await prepareImageModel("gemini", "gemini-2.5-flash-image", "sk-stub-gemini");

    const images = await resolve({ strategy: "ai" });

    // No credential for the pinned provider is a failure of the AI stage, and this stage is best effort.
    expect(images).toEqual([]);
    expect(calls.filter((call) => call.url.includes(":generateContent"))).toHaveLength(0);
    expect(generationCalls(calls)).toHaveLength(0);
  });

  it("answers with no images instead of failing when the provider is down", async () => {
    const calls = stubFetch(openAIRoutes(unavailable));
    await prepareOpenAIImage();

    const images = await resolve({ strategy: "ai", target: 3 });

    expect(images).toEqual([]);
    // `catch { break }`: one failure ends the AI stage, it does not retry it three times.
    expect(generationCalls(calls)).toHaveLength(1);
    expect(await artifacts()).toEqual([]);
  });

  it("answers with no images for an install that has no credential at all", async () => {
    const calls = stubFetch([]);

    const images = await resolve({ strategy: "ai", target: 3 });

    expect(images).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(await artifacts()).toEqual([]);
  });

  it("keeps the images it already has when generation fails (best effort)", async () => {
    // A rejected key is remembered by fingerprint for the life of the process (P3-B-1), so this case
    // signs with a secret of its own: `sk-stub-openai` has to stay healthy for the cases around it.
    const calls = stubFetch(openAIRoutes(unauthorized));
    await prepareImageModel("openai", "gpt-image-1", "sk-stub-openai-rejected");
    const sourcePath = await source("shot-pan.png");

    const images = await resolve({ strategy: "mixed", target: 3, productImagePaths: [sourcePath] });

    // The article still gets its cover: the AI stage failed, `resolveArticleImages` did not.
    expect(images).toHaveLength(1);
    expect(await bytesOf(images[0])).toBe("bytes-of-shot-pan.png");
    expect(await artifacts()).toEqual([path.basename(images[0])]);
    expect(generationCalls(calls)).toHaveLength(1);
  });

  it("spends at most maxGeneratedArticleImages per run, even when the target asks for more", async () => {
    const calls = stubFetch(openAIRoutes(() => openAIImageReply()));
    await prepareOpenAIImage();

    const images = await resolve({ strategy: "ai", target: 6 });

    // `imageCount: "many"` asks for six images; generation is the slow source, so it stops at three -
    // three calls, three files, three distinct names.
    expect(maxGeneratedArticleImages).toBe(3);
    expect(generationCalls(calls)).toHaveLength(3);
    expect(images).toHaveLength(3);
    expect(new Set(images).size).toBe(3);
    expect(await artifacts()).toHaveLength(3);
  });

  it("generates only what the earlier sources left open", async () => {
    const calls = stubFetch(openAIRoutes(() => openAIImageReply()));
    await prepareOpenAIImage();
    const sourcePath = await source("shot-pan.png");

    const images = await resolve({ strategy: "mixed", target: 2, productImagePaths: [sourcePath] });

    expect(images).toHaveLength(2);
    expect(await bytesOf(images[0])).toBe("bytes-of-shot-pan.png");
    expect(path.basename(images[1])).toMatch(/^agent-image-/);
    expect(generationCalls(calls)).toHaveLength(1);
  });

  it("never asks a provider when the earlier sources already reached the target", async () => {
    const calls = stubFetch(openAIRoutes(() => openAIImageReply()));
    // Callable on purpose: reaching the provider here would mean the AI stage ran anyway.
    await prepareOpenAIImage();
    const photos = await Promise.all([source("shot-1.png"), source("shot-2.png")]);

    const images = await resolve({ strategy: "mixed", target: 2, productImagePaths: photos });

    expect(images).toHaveLength(2);
    expect(generationCalls(calls)).toHaveLength(0);
  });

  /* ------------------------------------------------------------------ 4. the order the sources are spent in */

  it("fills in order: the product copy, then the page's og:image, then a generation", async () => {
    const pageUrl = "https://news.example.com/pages/1";
    const calls = stubFetch([
      ...pageRoutes([pageUrl]),
      { match: (url: string) => url.endsWith("/models"), respond: openAIImageCatalog },
      { match: (url: string) => url.includes("/images/generations"), respond: () => openAIImageReply() },
    ]);
    await prepareOpenAIImage();
    const sourcePath = await source("shot-pan.png");

    const images = await resolve({
      strategy: "mixed",
      target: 3,
      productImagePaths: [sourcePath],
      sourceUrls: [pageUrl],
    });

    expect(images).toHaveLength(3);
    expect(await bytesOf(images[0])).toBe("bytes-of-shot-pan.png");
    expect(images[1]).toBe("https://cdn.example.com/1.png");
    expect(path.basename(images[2])).toMatch(/^agent-image-/);

    // The cheap sources are spent first: the page is read before anything is generated.
    const pageIndex = calls.findIndex((call) => call.url === pageUrl);
    const generateIndex = calls.findIndex((call) => call.url.includes("/images/generations"));
    expect(pageIndex).toBeGreaterThanOrEqual(0);
    expect(pageIndex).toBeLessThan(generateIndex);
  });
});

