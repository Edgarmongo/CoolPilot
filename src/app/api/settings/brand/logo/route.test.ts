import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * P5-B0-2.5: the workspace keeps the brand logo in `<workspace>/uploads/brand-logos`, and this
 * route is the only writer of that section there - it initializes it, while `GET` and `DELETE` only
 * resolve the path of whatever logo settings point at, so a workspace that has no logo keeps its
 * uploads section missing instead of gaining an empty one.
 *
 * The harness pins the temp workspace and the database before anything that reads them loads
 * (`src/test/route-harness.ts`), so it has to be the first `await` here.
 */

const { routeTestDataDir } = await import("@/test/route-harness");
const { DELETE, GET, POST } = await import("./route");
const { getBrandSettings } = await import("@/db/repositories/settings");

const uploadsDir = path.join(routeTestDataDir, "uploads");
const section = path.join(uploadsDir, "brand-logos");

async function upload(bytes = "png-bytes") {
  const form = new FormData();
  form.append("file", new File([bytes], "logo.png", { type: "image/png" }));
  return POST(new Request("http://localhost/api/settings/brand/logo", { method: "POST", body: form }));
}

/** Keeps one case from deciding the state the next one reads. */
async function removeUploadsSection() {
  await DELETE();
  fs.rmSync(uploadsDir, { recursive: true, force: true });
}

describe("/api/settings/brand/logo", () => {
  afterEach(removeUploadsSection);

  it("stores the uploaded logo inside the uploads section of the workspace", async () => {
    const response = await upload();

    expect(response.status).toBe(200);
    const settings = await getBrandSettings();
    expect(path.dirname(settings.logoPath ?? "")).toBe(section);
    expect(fs.readFileSync(settings.logoPath ?? "", "utf-8")).toBe("png-bytes");
    // The upload initializes its own section, which carries its parent with it and nothing else.
    expect(fs.readdirSync(uploadsDir)).toEqual(["brand-logos"]);
  });

  it("serves the stored logo and removes it again", async () => {
    await upload();

    const served = await GET();
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(await served.text()).toBe("png-bytes");

    expect((await DELETE()).status).toBe(200);
    expect((await getBrandSettings()).logoPath).toBeUndefined();
    expect((await GET()).status).toBe(404);
    expect(fs.existsSync(section) ? fs.readdirSync(section) : []).toEqual([]);
  });

  it("replaces the previous logo instead of keeping both", async () => {
    await upload("first-logo");
    await upload("second-logo");

    expect(fs.readdirSync(section)).toHaveLength(1);
    expect(fs.readFileSync((await getBrandSettings()).logoPath ?? "", "utf-8")).toBe("second-logo");
  });

  it("answers a request for a logo that was never set without initializing the workspace", async () => {
    expect((await DELETE()).status).toBe(200);
    expect((await GET()).status).toBe(404);

    expect(fs.existsSync(uploadsDir)).toBe(false);
  });
});
