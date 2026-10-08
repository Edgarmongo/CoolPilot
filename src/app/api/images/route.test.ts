import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `api/images` on `aiRuntime` (batch P3-B-1 of `docs/generate-migration-p3.md`).
 *
 * The first surface of batch B, and the one that needed no migration: this route has called
 * `generateImageFile()` from `lib/agent/image-generation.ts` since P2, and that module *is* the domain
 * service over `aiRuntime.generateImage()` (D-P3-2). There is no facade import in the route's graph to
 * remove - which is exactly why this batch freezes instead of moving: the service underneath was
 * already covered by `src/lib/ai/generate.test.ts`, while the route's own contract (the 201 envelope,
 * the file left on disk, the provider that really answered, the flat 500 it words itself) had no
 * regression guard at all.
 *
 * One frozen decision and one the batch after it converged, both pinned here:
 *
 *  1. **The image provider is a hard pin, not a preference.** `settings.imageProvider` (default
 *     `openai`) reaches the runtime as `providerId`, so the candidate chain is one provider: no model
 *     failover, no cross-provider fallback, only key rotation inside that endpoint. The pin case below
 *     is the route-level counterpart of G3. Still frozen - P3-C changed no line of the image path.
 *  2. **The error envelope was a flat 500 and is now the runtime's own.** B-1 froze
 *     `fail(error.message, 500)`, which dropped the runtime's status *and* code (`MODEL_CREDENTIAL_MISSING`'s
 *     400, `MODEL_UPSTREAM_NO_CONTENT`'s 502 and `MODEL_NOT_CONFIGURED`'s 503 all arrived as `UNKNOWN_ERROR`)
 *     while keeping the runtime's own sentence, because P3-B-3 cut `image-generation.ts -> compat.ts` and took
 *     the shim's `Missing openai API key` with it. **P3-C (D1-b) applied D-P3-3 here**: every failure below now
 *     carries the runtime's code and status, which is also what lets a client branch on
 *     `MODEL_CAPABILITY_UNAVAILABLE` instead of on a sentence. The 201 cases, the pin, the size and the
 *     file on disk are untouched.
 *
 * The chain under test is the real one - route handler, domain service, runtime, registry, router, key
 * pool, provider adapter - and only the *transport* is stubbed. Nothing here asserts that a mock was
 * called.
 *
 * P4 deleted the three legacy modules this file used to mock with a throwing factory (`@/lib/ai`,
 * `@/lib/ai/generate`, `@/lib/ai/compat`). The guard is structural now: reviving one of them fails
 * `tsc` and module resolution instead of a single test file (`docs/generate-migration-p3.md`, P4).
 */

/**
 * The harness pins the temp database and the keyless env before anything that reads them loads
 * (`src/test/route-harness.ts`), so it has to be the first `await` here.
 */
const {
  credentials,
  jsonRequest,
  jsonResponse,
  prepareChatModel,
  prepareImageModel,
  resetRuntime,
  routeTestDataDir,
  stubFetch,
  unavailable,
  unauthorized,
} = await import("@/test/route-harness");
const { GET, POST, DELETE } = await import("./route");
const { updateLocalAgentSettings } = await import("@/db/repositories/settings");
const { artifactImageUrl } = await import("@/lib/artifact-image-url");

const imagesUrl = "http://localhost/api/images";

/** The artifacts directory of the *temp* data root, which is the only directory these cases touch. */
const artifactsDir = path.join(routeTestDataDir, "artifacts");

const postImage = (body: unknown) => POST(jsonRequest(imagesUrl, body));

const deleteImages = (body: unknown) =>
  DELETE(
    new Request(imagesUrl, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const bodyOf = (call: { init?: RequestInit } | undefined) =>
  JSON.parse(String(call?.init?.body)) as Record<string, unknown>;

type Call = { url: string; init?: RequestInit };

/** The image endpoint is the only AI call this route may make beside the gemini one. */
const imageCalls = (calls: Call[]) => calls.filter((call) => call.url.includes("/images/generations"));
const generateContentCalls = (calls: Call[]) => calls.filter((call) => call.url.includes(":generateContent"));
/** A text call would mean the image path fell back onto the chat channel; it never may. */
const textCalls = (calls: Call[]) => calls.filter((call) => call.url.includes("/chat/completions"));

/** Nothing may reach a real endpoint: an unmatched call is answered like a broken provider. */
const offline = () => jsonResponse({ error: { message: "unexpected call" } }, 503);

/** The files in the artifacts directory, sorted - a case can compare the whole directory. */
async function artifacts() {
  await fs.mkdir(artifactsDir, { recursive: true });
  return (await fs.readdir(artifactsDir)).sort();
}

async function clearArtifacts() {
  for (const name of await artifacts()) {
    await fs.rm(path.join(artifactsDir, name), { force: true });
  }
}

const artifactBytes = (fileName: string) => fs.readFile(path.join(artifactsDir, fileName), "utf-8");

/**
 * What each provider answers with, and what its catalog lists. The bytes are recognisable on purpose,
 * so "the file on disk is the decoded answer" is one assertion instead of a hash.
 */
const pngBytes = "fake-png-bytes";
const jpegBytes = "fake-jpeg-bytes";
const encoded = (value: string) => Buffer.from(value).toString("base64");

const openAIImageCatalog = () => jsonResponse({ data: [{ id: "gpt-image-1" }] });
const geminiImageCatalog = () =>
  jsonResponse({
    models: [
      {
        name: "models/gemini-2.5-flash-image",
        baseModelId: "gemini-2.5-flash-image",
        displayName: "Gemini 2.5 Flash Image",
        supportedGenerationMethods: ["generateContent"],
      },
    ],
  });

/** Base64 payloads: the OpenAI shape the adapter decodes without a second request. */
const openAIImageReply = (bytes = pngBytes) => jsonResponse({ data: [{ b64_json: encoded(bytes) }] });

/** The same answer as a link, which the adapter downloads and re-encodes itself. */
const openAIImageLinkReply = (url: string) => jsonResponse({ data: [{ url }] });

/** The Gemini shape: inline data on a JPEG, so the extension mapping shows up in the envelope too. */
const geminiImageReply = () =>
  jsonResponse({
    candidates: [
      {
        content: {
          parts: [
            { text: "here is your image" },
            { inlineData: { mimeType: "image/jpeg", data: encoded(jpegBytes) } },
          ],
        },
      },
    ],
  });

/** The usual fixture: one credential, one callable image model, the image capability default. */
const prepareOpenAIImage = () => prepareImageModel("openai", "gpt-image-1", "sk-stub-openai");

describe("POST /api/images on aiRuntime", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await resetRuntime();
    // The two settings the image path reads are restored here, because a case may pin the other
    // provider or another size and nothing else resets them.
    await updateLocalAgentSettings({ imageProvider: "openai", openAIImageSize: "1024x1024" });
    await clearArtifacts();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers 201 with the stored file, its URL and the provider/model the runtime really used", async () => {
    const calls = stubFetch([
      { match: (target) => target.endsWith("/models"), respond: openAIImageCatalog },
      { match: (target) => target.includes("/images/generations"), respond: () => openAIImageReply() },
    ]);
    await prepareOpenAIImage();

    const response = await postImage({ prompt: "a cat on a keyboard" });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.ok).toBe(true);
    // The file the domain service wrote, exposed the way the image library renders it.
    const { fileName, url, provider, model } = payload.data;
    expect(fileName.startsWith("agent-image-")).toBe(true);
    expect(fileName.endsWith(".png")).toBe(true);
    expect(url).toBe(artifactImageUrl(fileName));
    // What the route reports is what the runtime reported - not a hard-coded pair.
    expect(provider).toBe("openai");
    expect(model).toBe("gpt-image-1");

    // The bytes on disk are the decoded answer, and the directory holds nothing else.
    expect(await artifacts()).toEqual([fileName]);
    expect(await artifactBytes(fileName)).toBe(pngBytes);

    // One call to the images endpoint, signed by the one key that model is configured with.
    expect(imageCalls(calls)).toHaveLength(1);
    const [imageCall] = imageCalls(calls);
    expect(imageCall.url.endsWith("/images/generations")).toBe(true);
    expect((imageCall.init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-stub-openai");
    expect(bodyOf(imageCall)).toEqual({
      model: "gpt-image-1",
      prompt: "a cat on a keyboard",
      size: "1024x1024",
    });
    // ...and nothing on the chat channel: the image path never asks for text.
    expect(textCalls(calls)).toHaveLength(0);
  });

  it("trims the prompt the schema accepted and sends nothing else the caller passed", async () => {
    const calls = stubFetch([
      { match: (target) => target.endsWith("/models"), respond: openAIImageCatalog },
      { match: (target) => target.includes("/images/generations"), respond: () => openAIImageReply() },
    ]);
    await prepareOpenAIImage();

    const response = await postImage({ prompt: "  a cat on a keyboard  ", quality: "hd", n: 4 });

    expect(response.status).toBe(201);
    // The schema is not strict, so an extra field is dropped rather than rejected - and the wire shows
    // the three fields the domain service decided on, not the ones the request carried.
    expect(bodyOf(imageCalls(calls)[0])).toEqual({
      model: "gpt-image-1",
      prompt: "a cat on a keyboard",
      size: "1024x1024",
    });
  });

  it("takes the image size from the settings, never from the request", async () => {
    const calls = stubFetch([
      { match: (target) => target.endsWith("/models"), respond: openAIImageCatalog },
      { match: (target) => target.includes("/images/generations"), respond: () => openAIImageReply() },
    ]);
    await prepareOpenAIImage();
    await updateLocalAgentSettings({ openAIImageSize: "512x512" });

    const response = await postImage({ prompt: "a cat on a keyboard", size: "4096x4096" });

    expect(response.status).toBe(201);
    // The configured size wins, and the request's own `size` never reaches the provider.
    expect(bodyOf(imageCalls(calls)[0]).size).toBe("512x512");
  });

  it("keeps the image provider pinned instead of silently using the other one (G3)", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("/v1beta/models?"), respond: geminiImageCatalog },
      { match: () => true, respond: offline },
    ]);
    // Gemini is configured and callable; the settings still name OpenAI as the image provider.
    await prepareImageModel("gemini", "gemini-2.5-flash-image", "sk-stub-gemini");
    // Preparation syncs gemini's catalog; what this case measures is the request that follows.
    const prepared = calls.length;

    const response = await postImage({ prompt: "a cat on a keyboard" });
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.code).toBe("MODEL_NOT_CONFIGURED");
    // The runtime's routing sentence, not the shim's `Missing openai API key` (P3-B-3). The pin is why the
    // callable gemini model was not used instead, and why no other provider was asked: the candidate chain
    // is one provider wide.
    expect(payload.message).toBe("No model is configured for this request");
    expect(payload.message).not.toContain("Missing");
    expect(payload.error).toBe(payload.message);
    // The diagnosis travels with it now (D1-b): which capability failed, and which provider the requirement
    // had already narrowed the search to - the pin, visible in the error as well as in the wire.
    expect(payload.details.requirement.capability).toBe("image_generation");
    expect(payload.details.requirement.providerId).toBe("openai");
    expect(generateContentCalls(calls)).toHaveLength(0);
    expect(imageCalls(calls)).toHaveLength(0);
    // ...and why nothing was sent at all: routing never makes a request of its own, and the shim's one
    // exception to that - an on-demand discovery pass for the pinned provider - is what B-3 removed.
    expect(calls).toHaveLength(prepared);
    expect(await artifacts()).toEqual([]);
  });

  it("answers the runtime's own 409 MODEL_CAPABILITY_UNAVAILABLE when the pinned provider has no image model", async () => {
    const calls = stubFetch([
      { match: (target) => target.endsWith("/models"), respond: () => jsonResponse({ data: [{ id: "gpt-4o-mini" }] }) },
      { match: () => true, respond: offline },
    ]);
    // OpenAI is configured and callable - but only for text. `prepareChatModel` enables what its catalog
    // lists as a chat model, so the provider has an endpoint, a key and a model, and yet nothing it holds
    // provides `image_generation`. This is the state `creation/images` used to guess at with its
    // `/No image models returned/` string test - a sentence the runtime never produced, so the guess could
    // only ever fail. P3-C (D1-b) is what makes the code behind it readable instead.
    await prepareChatModel("openai", "gpt-4o-mini", "sk-stub-openai-text-only");
    const prepared = calls.length;

    const response = await postImage({ prompt: "a cat on a keyboard" });
    const payload = await response.json();

    // The runtime's 409, not a flat 500: "this provider cannot make images" is now distinguishable from
    // "the provider is broken" (502) and from "nothing is configured" (503) by a code, not by wording.
    expect(response.status).toBe(409);
    expect(payload.code).toBe("MODEL_CAPABILITY_UNAVAILABLE");
    expect(payload.details.requirement.capability).toBe("image_generation");
    expect(payload.details.reason).toBe("capability-missing");
    // Nothing was generated, and nothing was fetched while routing either.
    expect(imageCalls(calls)).toHaveLength(0);
    expect(calls).toHaveLength(prepared);
    expect(await artifacts()).toEqual([]);
  });

  it("routes a gemini-pinned install through the Gemini endpoint, leaving the OpenAI-shaped size alone", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("/v1beta/models?"), respond: geminiImageCatalog },
      { match: (target) => target.includes(":generateContent"), respond: geminiImageReply },
    ]);
    await prepareImageModel("gemini", "gemini-2.5-flash-image", "sk-stub-gemini");
    await updateLocalAgentSettings({ imageProvider: "gemini" });

    const response = await postImage({ prompt: "a cat on a keyboard" });
    const payload = await response.json();

    expect(response.status).toBe(201);
    // The mime type decides the extension: the domain service's own mapping, visible in the envelope.
    expect(payload.data.fileName.endsWith(".jpg")).toBe(true);
    expect(payload.data.provider).toBe("gemini");
    expect(payload.data.model).toBe("gemini-2.5-flash-image");
    expect(await artifactBytes(payload.data.fileName)).toBe(jpegBytes);

    expect(imageCalls(calls)).toHaveLength(0);
    expect(generateContentCalls(calls)).toHaveLength(1);
    const [call] = generateContentCalls(calls);
    expect(call.url).toContain("models/gemini-2.5-flash-image:generateContent");
    expect(call.url).toContain("key=sk-stub-gemini");
    expect(bodyOf(call)).toEqual({
      contents: [{ parts: [{ text: "a cat on a keyboard" }] }],
      generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
    });
    // `settings.openAIImageSize` still travels with the request on this path (P3-B-1 changes nothing),
    // but the gemini adapter has no field for it - so no size reaches the wire, and none is invented.
    expect(JSON.stringify(bodyOf(call))).not.toContain("1024x1024");
  });

  it("answers 400 INVALID_PAYLOAD for a body it cannot use, without asking any provider", async () => {
    const calls = stubFetch([{ match: () => true, respond: offline }]);

    const missing = await postImage({});
    const blank = await postImage({ prompt: "   " });
    const notJson = await POST(
      new Request(imagesUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
    );
    const missingPayload = await missing.json();
    const blankPayload = await blank.json();
    const notJsonPayload = await notJson.json();

    expect([missing.status, blank.status, notJson.status]).toEqual([400, 400, 400]);
    expect([missingPayload.code, blankPayload.code, notJsonPayload.code]).toEqual([
      "INVALID_PAYLOAD",
      "INVALID_PAYLOAD",
      "INVALID_PAYLOAD",
    ]);
    // The cause survives in `details` (the ZodError for a rejected field, the `INVALID_JSON` AppError
    // for a body that is not JSON) while the envelope's code stays the route's own - the long-standing
    // shape this route shares with the rest of the API layer.
    expect(blankPayload.details).toBeDefined();
    expect(notJsonPayload.details.code).toBe("INVALID_JSON");
    expect(calls).toHaveLength(0);
    expect(await artifacts()).toEqual([]);
  });

  it("answers the runtime's own 503 MODEL_NOT_CONFIGURED when the install has no credential at all", async () => {
    const calls = stubFetch([{ match: () => true, respond: offline }]);
    // Nothing is prepared: no key, no callable model, no image capability default.
    const response = await postImage({ prompt: "a cat on a keyboard" });
    const payload = await response.json();

    // "Nothing is configured" is a 503, and the sentence a keyless install reads is the runtime's (P3-B-3 cut
    // the shim that used to word this as `Missing openai API key`) - status, code and sentence all pass on.
    expect(response.status).toBe(503);
    expect(payload.code).toBe("MODEL_NOT_CONFIGURED");
    expect(payload.message).toBe("No model is configured for this request");
    expect(payload.message).not.toContain("sk-");
    expect(payload.details.requirement.capability).toBe("image_generation");
    expect(Array.isArray(payload.details.missing)).toBe(true);
    // Nothing on the wire either - no model call and no catalog read: an empty registry is not discovered
    // on demand any more.
    expect(calls).toHaveLength(0);
    expect(imageCalls(calls)).toHaveLength(0);
    expect(await artifacts()).toEqual([]);
  });

  it("no longer syncs the pinned provider's catalog on demand (P3-B-3)", async () => {
    const calls = stubFetch([
      { match: (target) => target.endsWith("/models"), respond: openAIImageCatalog },
      { match: (target) => target.includes("/images/generations"), respond: () => openAIImageReply() },
    ]);
    // A key was pasted and nothing else: the provider has an endpoint and a credential but no catalog row.
    // That is the exact state the shim's discovery pass used to rescue inside a failed request - it would
    // read `/models`, enable what it found and answer 201. The pinned provider is still not routable, so
    // the request is not made at all.
    await credentials.writeCredential(credentials.credentialRefFor("openai"), "sk-stub-openai-unsynced");

    const response = await postImage({ prompt: "a cat on a keyboard" });
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.code).toBe("MODEL_NOT_CONFIGURED");
    expect(payload.message).toBe("No model is configured for this request");
    expect(calls).toHaveLength(0);
    expect(await artifacts()).toEqual([]);
  });

  it("answers the runtime's own 400 MODEL_CREDENTIAL_MISSING when the key is revoked after the model was configured", async () => {
    const calls = stubFetch([
      { match: (target) => target.endsWith("/models"), respond: openAIImageCatalog },
      { match: (target) => target.includes("/images/generations"), respond: () => openAIImageReply() },
    ]);
    await prepareOpenAIImage();
    await credentials.clearCredential(credentials.credentialRefFor("openai"));

    const response = await postImage({ prompt: "a cat on a keyboard" });
    const payload = await response.json();

    // A configured model with no usable key is `MODEL_CREDENTIAL_MISSING` (a 400 in the runtime), and P3-C
    // passes that status on where the flat 500 used to hide it - the sentence underneath is still the
    // runtime's, because the shim's `MissingAIKeyError` is gone from this path (P3-B-3).
    expect(response.status).toBe(400);
    expect(payload.code).toBe("MODEL_CREDENTIAL_MISSING");
    expect(payload.message).toBe("No configured model has a usable credential for this request");
    expect(payload.details.reason).toBe("credential-missing");
    expect(payload.message).not.toContain("sk-");
    expect(imageCalls(calls)).toHaveLength(0);
    expect(await artifacts()).toEqual([]);
  });

  it("keeps the flat 500 when the provider rejects the key", async () => {
    const calls = stubFetch([
      { match: (target) => target.endsWith("/models"), respond: openAIImageCatalog },
      { match: (target) => target.includes("/images/generations"), respond: unauthorized },
    ]);
    // A rejected key of its own: the pool remembers health by key fingerprint in SQLite and an
    // `invalid` status never expires, so reusing the fixture key here would take every later case in
    // this file out of rotation with it (`prepareModel` would fail before the route was even called).
    await prepareImageModel("openai", "gpt-image-1", "sk-stub-openai-rejected");

    const response = await postImage({ prompt: "a cat on a keyboard" });
    const payload = await response.json();

    // `MODEL_CREDENTIAL_INVALID` is a 502 in the runtime and the upstream body is in its message; P3-C passes
    // both the code and the status on - one attempt (one model, one key), no file - and the diagnosis behind
    // it (the upstream status) travels in `details`, without ever echoing the key.
    expect(response.status).toBe(502);
    expect(payload.code).toBe("MODEL_CREDENTIAL_INVALID");
    expect(payload.message).toContain("HTTP 401");
    expect(payload.message).not.toContain("sk-");
    expect(payload.details.status).toBe(401);
    expect(imageCalls(calls)).toHaveLength(1);
    expect(await artifacts()).toEqual([]);
  });

  it("answers the runtime's own 502 MODEL_UPSTREAM_FAILED when the provider is down", async () => {
    const calls = stubFetch([
      { match: (target) => target.endsWith("/models"), respond: openAIImageCatalog },
      { match: (target) => target.includes("/images/generations"), respond: unavailable },
    ]);
    await prepareOpenAIImage();

    const response = await postImage({ prompt: "a cat on a keyboard" });
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload.code).toBe("MODEL_UPSTREAM_FAILED");
    expect(payload.message).toContain("HTTP 503");
    expect(payload.details.status).toBe(503);
    expect(imageCalls(calls)).toHaveLength(1);
    expect(await artifacts()).toEqual([]);
  });

  it("answers the runtime's own 502 MODEL_UPSTREAM_NO_CONTENT when the provider answers without any image data", async () => {
    const calls = stubFetch([
      { match: (target) => target.endsWith("/models"), respond: openAIImageCatalog },
      { match: (target) => target.includes("/images/generations"), respond: () => jsonResponse({ data: [] }) },
    ]);
    await prepareOpenAIImage();

    const response = await postImage({ prompt: "a cat on a keyboard" });
    const payload = await response.json();

    // The adapter's own `MODEL_UPSTREAM_NO_CONTENT` (a 502) is the failure here, and it now leaves as itself:
    // same status, the runtime's code, and the model it failed on in `details`.
    expect(response.status).toBe(502);
    expect(payload.code).toBe("MODEL_UPSTREAM_NO_CONTENT");
    expect(payload.message).toContain("returned no image data");
    expect(payload.details.model).toBe("gpt-image-1");
    expect(imageCalls(calls)).toHaveLength(1);
    expect(await artifacts()).toEqual([]);
  });

  it("still guards the empty image the adapter let through, and writes no file", async () => {
    stubFetch([
      { match: (target) => target.endsWith("/models"), respond: openAIImageCatalog },
      {
        match: (target) => target.includes("/images/generations"),
        respond: () => openAIImageLinkReply("https://cdn.example.test/empty.png"),
      },
      // A 200 with an empty body: the adapter downloads it, decodes zero bytes and hands the domain
      // service a payload that is present but empty - the one shape the service's own guard is for.
      { match: (target) => target.includes("cdn.example.test"), respond: () => jsonResponse({}) },
    ]);
    await prepareOpenAIImage();

    const response = await postImage({ prompt: "a cat on a keyboard" });
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload.code).toBe("MODEL_UPSTREAM_NO_CONTENT");
    // Lowercase `openai`, not the adapter's `OpenAI`: that is the domain service refusing to name a
    // file after an empty payload, which is what keeps `writeBase64Image` from writing a 0-byte image.
    expect(payload.message).toBe("openai returned no image data");
    // The service words its own `details`, so the code is the runtime's vocabulary while the sentence is the
    // domain's - both reach the client now (D1-b), and neither carries a key.
    expect(payload.details.providerId).toBe("openai");
    expect(await artifacts()).toEqual([]);
  });

  it("gives every generated image its own file name", async () => {
    let generated = 0;
    const calls = stubFetch([
      { match: (target) => target.endsWith("/models"), respond: openAIImageCatalog },
      {
        match: (target) => target.includes("/images/generations"),
        respond: () => openAIImageReply(`bytes-${(generated += 1)}`),
      },
    ]);
    await prepareOpenAIImage();

    const first = (await (await postImage({ prompt: "a cat on a keyboard" })).json()).data;
    const second = (await (await postImage({ prompt: "a cat on a keyboard" })).json()).data;

    // Two identical requests, two files: the name carries both a timestamp and a random suffix.
    expect(first.fileName).not.toBe(second.fileName);
    expect(await artifacts()).toEqual([first.fileName, second.fileName].sort());
    expect(await artifactBytes(first.fileName)).toBe("bytes-1");
    expect(await artifactBytes(second.fileName)).toBe("bytes-2");
    expect(imageCalls(calls)).toHaveLength(2);
  });

});

/**
 * The other half of the route: no provider is involved, only the artifacts directory. These cases pin
 * what the image library (and the pickers that read it) depends on - which files count as images, how
 * they are ordered, and that a delete can never reach outside the directory.
 */
describe("GET and DELETE /api/images (the library half)", () => {
  beforeEach(async () => {
    await clearArtifacts();
  });

  afterEach(async () => {
    await clearArtifacts();
  });

  it("lists only the files it can serve, and newest name first", async () => {
    await fs.mkdir(artifactsDir, { recursive: true });
    for (const name of ["agent-image-1-first.webp", "agent-image-2-second.jpg", "agent-image-3-third.png"]) {
      await fs.writeFile(path.join(artifactsDir, name), "x");
    }
    // Not an image the library serves, so it must not appear even though it sits in the directory.
    await fs.writeFile(path.join(artifactsDir, "notes.txt"), "x");

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data.images).toEqual([
      { fileName: "agent-image-3-third.png", url: artifactImageUrl("agent-image-3-third.png") },
      { fileName: "agent-image-2-second.jpg", url: artifactImageUrl("agent-image-2-second.jpg") },
      { fileName: "agent-image-1-first.webp", url: artifactImageUrl("agent-image-1-first.webp") },
    ]);
  });

  it("removes exactly the named images and nothing else", async () => {
    await fs.mkdir(artifactsDir, { recursive: true });
    for (const name of ["keep.png", "gone.jpg", "notes.txt"]) {
      await fs.writeFile(path.join(artifactsDir, name), "x");
    }
    // One level above the artifacts root: the traversal attempt below must not touch it.
    const outside = path.join(routeTestDataDir, "outside.png");
    await fs.writeFile(outside, "x");

    const response = await deleteImages({
      // A traversal attempt, a file that is not an image, and one that is not there: all skipped.
      fileNames: ["gone.jpg", "../outside.png", "notes.txt", "missing.png"],
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    // `fs.rm(..., { force: true })` does not report a missing file, so a name that was never there is
    // still listed - pre-existing behaviour of `lib/image-library.ts`, pinned as it is so the delete
    // envelope cannot quietly change meaning. What matters is what *was* removed: only the image that
    // existed, only inside the artifacts root.
    expect(payload.data.deleted).toEqual(["gone.jpg", "missing.png"]);
    expect(await artifacts()).toEqual(["keep.png", "notes.txt"]);
    expect(await fs.readFile(outside, "utf-8")).toBe("x");
  });

  it("answers 400 for a delete payload it cannot use", async () => {
    const empty = await deleteImages({ fileNames: [] });
    const blank = await deleteImages({ fileNames: ["   "] });
    const tooMany = await deleteImages({ fileNames: Array.from({ length: 201 }, (_, index) => `image-${index}.png`) });

    expect([empty.status, blank.status, tooMany.status]).toEqual([400, 400, 400]);
    const payload = await empty.json();
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("INVALID_PAYLOAD");
  });
});
