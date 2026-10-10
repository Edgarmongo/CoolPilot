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
 * CI-AI-IMG-CONFIG-03 changed one thing the AI stage depends on: the image request is routed to the
 * provider that *owns* images (`openai-image` / `gemini-image`), whose endpoint is the one
 * `openAIImageBaseUrl` names - never the text provider's. The stage itself, and the best-effort
 * `catch { break }` around it, are exactly as P3-B-2 froze them.
 *
 * P4 deleted the three legacy modules this file used to mock with a throwing factory (`@/lib/ai`,
 * `@/lib/ai/generate`, `@/lib/ai/compat`). The guard is structural now: reviving one of them fails
 * `tsc` and module resolution instead of a single test file (`docs/generate-migration-p3.md`, P4).
 */

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

/** The remote image a page points at, as the wire the C4 downloader reads (`ok`, type, bytes). */
const remoteImageBytes = "remote-image-bytes";

function binaryResponse(bytes: string, contentType: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": contentType }),
    text: async () => bytes,
    json: async () => ({}),
    arrayBuffer: async () => Uint8Array.from(Buffer.from(bytes)).buffer as ArrayBuffer,
  } as unknown as Response;
}

/** The `og:image` address `pageRoutes()` writes for a page url - the address C4 has to download. */
const cdnUrlOf = (url: string) => `https://cdn.example.com/${url.split("/").pop()}.png`;

/**
 * Every page plus the image each one names, so the `web` stage can localize it: C4 downloads the
 * `og:image` into `artifacts/` instead of storing the address as the cover.
 */
const localizableRoutes = (urls: string[]) => [
  ...pageRoutes(urls),
  ...urls.map((url) => ({
    match: (target: string) => target === cdnUrlOf(url),
    respond: () => binaryResponse(remoteImageBytes, "image/png"),
  })),
];

/** A stored artifact by its name: the strategy answers with file names, files live in artifacts. */
const fileOf = (fileName: string) => path.join(artifactsDir, fileName);

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

/**
 * The endpoint the image settings name (CI-AI-IMG-CONFIG-03). `openAIImageBaseUrl` is the only field an
 * OpenAI-compatible image request may be signed against, so a host of its own makes a fallback onto the
 * text provider visible in the wire assertion rather than only in a status.
 */
const imageBaseUrl = "https://images.example.test/v1";

/** The usual fixture: one credential, one callable image model, the image capability default. */
const prepareOpenAIImage = () => prepareImageModel("openai-image", "gpt-image-1", "sk-stub-openai-image");

describe("resolveArticleImages on aiRuntime", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await resetRuntime();
    // The three settings this path reads are restored here, because a case may pin the other provider,
    // another size or another URL and nothing else resets them. The URL is what gives the image
    // provider an endpoint at all (Q4): `prepareImageModel()` reconciles it before reading a catalog.
    await updateLocalAgentSettings({
      imageProvider: "openai",
      openAIImageSize: "1024x1024",
      openAIImageBaseUrl: imageBaseUrl,
    });
    await clearArtifacts();
    await fs.rm(sourceDir, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /* ------------------------------------------------------------------ 1. the product stage */

  it("copies a product photo into artifacts and leaves the source where the product keeps it", async () => {
    const sourcePath = await source("shot-pan.png");

    const resolution = await resolve({ productImagePaths: [sourcePath] });
    const { images } = resolution;

    expect(images).toHaveLength(1);
    const [copy] = images;
    // C4: the stored reference is a file name - the path of the machine that produced it is not part of
    // what the item says about its own image - and the provenance is still in the name.
    expect(copy).toMatch(/^writing-\d+-[A-Za-z0-9_-]{8}\.png$/);
    // A copy, not a move: the bytes are in artifacts and the product photo is still where it was.
    expect(await bytesOf(fileOf(copy))).toBe("bytes-of-shot-pan.png");
    await expect(fs.stat(sourcePath)).resolves.toBeTruthy();
    expect(await artifacts()).toEqual([copy]);
    // Identity and origin, in the same order as the images: this one is a copy of a stored photo.
    expect(resolution.assets).toEqual([
      expect.objectContaining({ reference: copy, fileName: copy, source: "copied", external: false }),
    ]);
    expect(resolution.skippedRemoteImages).toEqual([]);
  });

  it("keeps the source extension, lower-cased, and falls back to .png when the path has none", async () => {
    const jpeg = await source("shot-lid.JPG");
    const extensionless = await source("shot-no-extension");

    const { images } = await resolve({ target: 2, productImagePaths: [jpeg, extensionless] });

    expect(images.map((image) => path.extname(image))).toEqual([".jpg", ".png"]);
  });

  it("skips a product photo that is not on disk and still copies the one that is", async () => {
    const missing = path.join(sourceDir, "never-written.png");
    const present = await source("shot-lid.png");

    const { images } = await resolve({ target: 3, productImagePaths: [missing, present] });

    expect(images).toHaveLength(1);
    expect(await bytesOf(fileOf(images[0]))).toBe("bytes-of-shot-lid.png");
  });

  it("ignores a blank entry instead of asking the filesystem about it", async () => {
    const present = await source("shot-pan.png");

    const { images } = await resolve({ target: 3, productImagePaths: ["", present] });

    expect(images).toHaveLength(1);
  });

  it("stops at target, in the order the caller selected the products", async () => {
    const photos = await Promise.all([source("shot-1.png"), source("shot-2.png"), source("shot-3.png")]);

    const { images } = await resolve({ target: 2, productImagePaths: photos });

    // Two files, and they are the *first two* photos - which the generated names cannot show.
    expect(await Promise.all(images.map((image) => bytesOf(fileOf(image))))).toEqual([
      "bytes-of-shot-1.png",
      "bytes-of-shot-2.png",
    ]);
    expect(await artifacts()).toEqual([...images].sort());
  });

  it("never reads a source page when the strategy is product only", async () => {
    const sourcePath = await source("shot-pan.png");
    const pageUrl = "https://news.example.com/pages/1";
    const calls = stubFetch(pageRoutes([pageUrl]));

    const { images } = await resolve({
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

  it("downloads the page's og:image into artifacts and keeps the address it came from", async () => {
    const pageUrl = "https://news.example.com/pages/1";
    stubFetch(localizableRoutes([pageUrl]));

    const resolution = await resolve({ strategy: "web", sourceUrls: [pageUrl] });
    const { images } = resolution;

    // C4: the page's image is brought into the workspace, so the cover is a local file the publish path
    // can actually ship, not an address it would drop.
    expect(images).toHaveLength(1);
    expect(images[0]).toMatch(/^online-\d+-[A-Za-z0-9_-]{8}\.png$/);
    expect(await artifacts()).toEqual([images[0]]);
    expect(await bytesOf(fileOf(images[0]))).toBe(remoteImageBytes);
    // Where it came from is not lost: the asset keeps the address the file was downloaded from.
    expect(resolution.assets).toEqual([
      expect.objectContaining({
        reference: images[0],
        fileName: images[0],
        source: "remote",
        external: false,
        remoteUrl: "https://cdn.example.com/1.png",
      }),
    ]);
    expect(resolution.skippedRemoteImages).toEqual([]);
  });

  it("ignores the product photos when the strategy is web only", async () => {
    const sourcePath = await source("shot-pan.png");
    const pageUrl = "https://news.example.com/pages/1";
    stubFetch(localizableRoutes([pageUrl]));

    const { images } = await resolve({ strategy: "web", target: 3, productImagePaths: [sourcePath], sourceUrls: [pageUrl] });

    expect(images).toHaveLength(1);
    expect(await bytesOf(fileOf(images[0]))).toBe(remoteImageBytes);
    // The photo was not copied: the workspace holds the page's own image only.
    expect(await artifacts()).toEqual([images[0]]);
  });

  it("reads at most the first three source urls", async () => {
    const urls = [1, 2, 3, 4, 5].map((index) => `https://news.example.com/pages/${index}`);
    const calls = stubFetch(localizableRoutes(urls));

    const { images } = await resolve({ strategy: "web", target: 6, sourceUrls: urls });

    // Three, although the target asked for six and every page could have answered.
    expect(images).toHaveLength(3);
    expect(await artifacts()).toEqual([...images].sort());
    // Not "ignored after the third": the fourth page was never fetched, and each page that *was* read had
    // its image downloaded right after it.
    expect(calls.map((call) => call.url)).toEqual(
      urls.slice(0, 3).flatMap((url) => [url, cdnUrlOf(url)]),
    );
  });

  it("keeps going after a page that is down or carries no og:image", async () => {
    const dead = "https://news.example.com/pages/dead";
    const bare = "https://news.example.com/pages/bare";
    const good = "https://news.example.com/pages/good";
    const calls = stubFetch([
      { match: (target: string) => target === dead, respond: () => htmlResponse(page(), 503) },
      { match: (target: string) => target === bare, respond: () => htmlResponse(page()) },
      { match: (target: string) => target === good, respond: () => htmlResponse(page(cdnUrlOf(good))) },
      { match: (target: string) => target === cdnUrlOf(good), respond: () => binaryResponse(remoteImageBytes, "image/png") },
    ]);

    const resolution = await resolve({ strategy: "web", target: 3, sourceUrls: [dead, bare, good] });
    const { images } = resolution;

    expect(images).toHaveLength(1);
    expect(await bytesOf(fileOf(images[0]))).toBe(remoteImageBytes);
    // A down page and a page with no image are not failures to report: nothing was there to localize.
    expect(resolution.skippedRemoteImages).toEqual([]);
    // All three pages were tried: an ignored page does not end the loop.
    expect(calls.filter((call) => call.url === dead || call.url === bare || call.url === good)).toHaveLength(3);
  });

  it("adds the same image only once", async () => {
    const urls = ["https://news.example.com/pages/a", "https://news.example.com/pages/b"];
    const shared = "https://cdn.example.com/shared.png";
    const calls = stubFetch([
      ...urls.map((url) => ({
        match: (target: string) => target === url,
        respond: () => htmlResponse(page(shared)),
      })),
      { match: (target: string) => target === shared, respond: () => binaryResponse(remoteImageBytes, "image/png") },
    ]);

    const { images } = await resolve({ strategy: "web", target: 3, sourceUrls: urls });

    // Two pages naming one address produce one image and one download, not two copies of the same file.
    expect(images).toHaveLength(1);
    expect(await artifacts()).toEqual([images[0]]);
    expect(calls.filter((call) => call.url === shared)).toHaveLength(1);
  });

  it("reports a remote image it could not download instead of storing the address as one", async () => {
    const pageUrl = "https://news.example.com/pages/broken";
    stubFetch([
      { match: (target: string) => target === pageUrl, respond: () => htmlResponse(page(cdnUrlOf(pageUrl))) },
      { match: (target: string) => target === cdnUrlOf(pageUrl), respond: () => binaryResponse("nope", "image/png", 503) },
    ]);

    const resolution = await resolve({ strategy: "web", sourceUrls: [pageUrl] });

    // No image is claimed and no remote address is stored as if it were one: the failure is named, so
    // "this article has no cover" stays a different statement from "the download failed".
    expect(resolution.images).toEqual([]);
    expect(resolution.assets).toEqual([]);
    expect(resolution.skippedRemoteImages).toEqual([cdnUrlOf(pageUrl)]);
    expect(await artifacts()).toEqual([]);
  });

  /* ------------------------------------------------------------------ 3. the AI stage */

  it("generates the missing image, names the article in the prompt and reports the model that made it", async () => {
    const calls = stubFetch(openAIRoutes(() => openAIImageReply()));
    await prepareOpenAIImage();

    const resolution = await resolve({ strategy: "ai" });
    const { images } = resolution;

    expect(images).toHaveLength(1);
    const [generated] = images;
    // The other half of the provenance: this file is a generation, not a copy of a product photo.
    expect(generated).toMatch(/^agent-image-\d+-[A-Za-z0-9_-]{8}\.png$/);
    expect(await bytesOf(fileOf(generated))).toBe(pngBytes);
    // C4: the writer knows which model produced the file, so the item records it per image instead of
    // leaving `metadata.provider/model` (the *text* model) to be misread as the image's.
    expect(resolution.assets).toEqual([
      expect.objectContaining({
        reference: generated,
        fileName: generated,
        source: "generated",
        external: false,
        provider: "openai-image",
        model: "gpt-image-1",
      }),
    ]);

    // One generation, with the runtime's model and the OpenAI-shaped size the setting holds.
    const generations = generationCalls(calls);
    expect(generations).toHaveLength(1);
    expect(generations[0].url).toBe(`${imageBaseUrl}/images/generations`);
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
    await prepareImageModel("gemini-image", "gemini-2.5-flash-image", "sk-stub-gemini");

    const { images } = await resolve({ strategy: "ai" });

    // No credential for the pinned provider is a failure of the AI stage, and this stage is best effort.
    expect(images).toEqual([]);
    expect(calls.filter((call) => call.url.includes(":generateContent"))).toHaveLength(0);
    expect(generationCalls(calls)).toHaveLength(0);
  });

  it("answers with no images instead of failing when the provider is down", async () => {
    const calls = stubFetch(openAIRoutes(unavailable));
    await prepareOpenAIImage();

    const { images } = await resolve({ strategy: "ai", target: 3 });

    expect(images).toEqual([]);
    // `catch { break }`: one failure ends the AI stage, it does not retry it three times.
    expect(generationCalls(calls)).toHaveLength(1);
    expect(await artifacts()).toEqual([]);
  });

  it("answers with no images for an install that has no credential at all", async () => {
    const calls = stubFetch([]);

    const { images } = await resolve({ strategy: "ai", target: 3 });

    expect(images).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(await artifacts()).toEqual([]);
  });

  it("keeps the images it already has when generation fails (best effort)", async () => {
    // A rejected key is remembered by fingerprint for the life of the process (P3-B-1), so this case
    // signs with a secret of its own: `sk-stub-openai-image` has to stay healthy for the cases around it.
    const calls = stubFetch(openAIRoutes(unauthorized));
    await prepareImageModel("openai-image", "gpt-image-1", "sk-stub-openai-image-rejected");
    const sourcePath = await source("shot-pan.png");

    const { images } = await resolve({ strategy: "mixed", target: 3, productImagePaths: [sourcePath] });

    // The article still gets its cover: the AI stage failed, `resolveArticleImages` did not.
    expect(images).toHaveLength(1);
    expect(await bytesOf(fileOf(images[0]))).toBe("bytes-of-shot-pan.png");
    expect(await artifacts()).toEqual([images[0]]);
    expect(generationCalls(calls)).toHaveLength(1);
  });

  it("spends at most maxGeneratedArticleImages per run, even when the target asks for more", async () => {
    const calls = stubFetch(openAIRoutes(() => openAIImageReply()));
    await prepareOpenAIImage();

    const { images } = await resolve({ strategy: "ai", target: 6 });

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

    const { images } = await resolve({ strategy: "mixed", target: 2, productImagePaths: [sourcePath] });

    expect(images).toHaveLength(2);
    expect(await bytesOf(fileOf(images[0]))).toBe("bytes-of-shot-pan.png");
    expect(images[1]).toMatch(/^agent-image-/);
    expect(generationCalls(calls)).toHaveLength(1);
  });

  it("never asks a provider when the earlier sources already reached the target", async () => {
    const calls = stubFetch(openAIRoutes(() => openAIImageReply()));
    // Callable on purpose: reaching the provider here would mean the AI stage ran anyway.
    await prepareOpenAIImage();
    const photos = await Promise.all([source("shot-1.png"), source("shot-2.png")]);

    const { images } = await resolve({ strategy: "mixed", target: 2, productImagePaths: photos });

    expect(images).toHaveLength(2);
    expect(generationCalls(calls)).toHaveLength(0);
  });

  /* ------------------------------------------------------------------ 4. the order the sources are spent in */

  it("fills in order: the product copy, then the page's og:image, then a generation", async () => {
    const pageUrl = "https://news.example.com/pages/1";
    const calls = stubFetch([
      ...localizableRoutes([pageUrl]),
      { match: (url: string) => url.endsWith("/models"), respond: openAIImageCatalog },
      { match: (url: string) => url.includes("/images/generations"), respond: () => openAIImageReply() },
    ]);
    await prepareOpenAIImage();
    const sourcePath = await source("shot-pan.png");

    const resolution = await resolve({
      strategy: "mixed",
      target: 3,
      productImagePaths: [sourcePath],
      sourceUrls: [pageUrl],
    });
    const { images } = resolution;

    expect(images).toHaveLength(3);
    expect(await bytesOf(fileOf(images[0]))).toBe("bytes-of-shot-pan.png");
    // The second image is the page's own, localized - and the address it came from is recorded on it.
    expect(images[1]).toMatch(/^online-/);
    expect(resolution.assets.map((asset) => asset.source)).toEqual(["copied", "remote", "generated"]);
    expect(resolution.assets[1].remoteUrl).toBe("https://cdn.example.com/1.png");
    expect(images[2]).toMatch(/^agent-image-/);

    // The cheap sources are spent first: the page is read before anything is generated.
    const pageIndex = calls.findIndex((call) => call.url === pageUrl);
    const generateIndex = calls.findIndex((call) => call.url.includes("/images/generations"));
    expect(pageIndex).toBeGreaterThanOrEqual(0);
    expect(pageIndex).toBeLessThan(generateIndex);
  });
});

