import { describe, expect, it } from "vitest";

/**
 * CI-P1-03-02: tool discovery over HTTP, per `docs/coolpilot-integration-contracts.md` §3.2 layer 5.
 *
 * `src/lib/tools/tool-library.test.ts` pins *which* tools are callable; this file pins what the route
 * adds to that answer over the wire, and it deliberately adds almost nothing:
 *
 * - the list arrives in the envelope the console already reads (`{ ok, data }`) and `data` is the list;
 * - `inputSchema` is the JSON Schema of the tool's own Zod schema, so a caller can build a form or a
 *   request body from discovery alone - the two halves of CI-P1-03 cannot describe different tools;
 * - an Agent-private tool is not advertised: a name a caller cannot supply the context for must not
 *   appear in a list of things a caller may call.
 */

const { GET } = await import("./route");

async function discovery() {
  const response = await GET();
  return { status: response.status, body: await response.json() };
}

describe("GET /api/tools", () => {
  it("answers the callable tools in the console's envelope", async () => {
    const { status, body } = await discovery();

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.map((tool: { name: string }) => tool.name)).toEqual([
      "generate_image_file",
      "media_list_assets",
      "video_render",
    ]);
  });

  it("publishes the contract a caller calls with, not a description of it", async () => {
    const { body } = await discovery();
    const listing = body.data.find((tool: { name: string }) => tool.name === "media_list_assets");

    expect(listing.description).toContain("List the media files");
    expect(listing.inputSchema.type).toBe("object");
    expect(Object.keys(listing.inputSchema.properties)).toEqual(["root", "limit"]);
    expect(listing.inputSchema.properties.root.enum).toEqual([
      "artifacts",
      "videos",
      // CI-P3-02: the imported audio/video a transcription reads is listable through this same tool.
      "media",
      "product-images",
      "brand-logos",
    ]);
    expect(listing.inputSchema.properties.limit).toMatchObject({ type: "integer", maximum: 500 });
  });

  it("advertises no tool whose context a caller of this entry cannot supply", async () => {
    const { body } = await discovery();
    const names = body.data.map((tool: { name: string }) => tool.name);

    expect(names).toHaveLength(3);
    for (const agentOnly of [
      "browser_open_page",
      "browser_click",
      "browser_type",
      "browser_screenshot",
      "generate_social_post_draft",
      "generate_image_prompt",
      "threads_create_post",
      "xiaohongshu_create_post",
    ]) {
      expect(names).not.toContain(agentOnly);
    }
  });

  it("answers the same list twice: discovery is a read of one registry", async () => {
    const first = await discovery();
    const second = await discovery();
    expect(second.body).toEqual(first.body);
  });
});
