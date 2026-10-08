import fs from "node:fs";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";

/**
 * P5-B0-2.5: the product images a user uploads are a workspace asset, and this route is where they
 * enter it. The section is `<workspace>/uploads/product-images` - the upload is a writer, so it
 * initializes the directory, while `GET` and `DELETE` only resolve it and must leave a workspace
 * that has no uploads section exactly as they found it.
 */

const previousDataDir = process.env.SOCIAL_AUTO_POST_DATA_DIR;

let workspace = "";

/** A workspace that does not exist yet, so a read that created anything would be visible. */
function pinWorkspace() {
  workspace = fs.mkdtempSync(path.join(tmpdir(), "coolpilot-product-image-"));
  process.env.SOCIAL_AUTO_POST_DATA_DIR = workspace;
}

pinWorkspace();
const { DELETE, GET, POST } = await import("./route");

const section = () => path.join(workspace, "uploads", "product-images");

async function upload(file = new File(["png-bytes"], "photo.png", { type: "image/png" })) {
  const form = new FormData();
  form.append("file", file);
  return POST(new Request("http://localhost/api/products/image", { method: "POST", body: form }));
}

function get(file: string) {
  return GET(new Request(`http://localhost/api/products/image?file=${encodeURIComponent(file)}`));
}

function remove(file: string) {
  return DELETE(
    new Request(`http://localhost/api/products/image?file=${encodeURIComponent(file)}`, {
      method: "DELETE",
    }),
  );
}

describe("/api/products/image", () => {
  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  afterAll(() => {
    if (previousDataDir === undefined) delete process.env.SOCIAL_AUTO_POST_DATA_DIR;
    else process.env.SOCIAL_AUTO_POST_DATA_DIR = previousDataDir;
  });

  it("stores an uploaded image inside the uploads section of the workspace", async () => {
    const response = await upload();

    expect(response.status).toBe(201);
    const { data } = await response.json();
    expect(path.dirname(data.imagePath)).toBe(section());
    expect(fs.readFileSync(data.imagePath, "utf-8")).toBe("png-bytes");
    expect(data.imageUrl).toBe(`/api/products/image?file=${path.basename(data.imagePath)}`);
    // The upload initializes its own section and nothing else.
    expect(fs.readdirSync(workspace)).toEqual(["uploads"]);
    expect(fs.readdirSync(path.join(workspace, "uploads"))).toEqual(["product-images"]);
  });

  it("serves a stored image and deletes it again", async () => {
    const uploaded = await (await upload()).json();
    const fileName = path.basename(uploaded.data.imagePath);

    const served = await get(fileName);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(await served.text()).toBe("png-bytes");

    expect((await remove(fileName)).status).toBe(200);
    expect(fs.existsSync(uploaded.data.imagePath)).toBe(false);
  });

  it("answers a request for an image without initializing the workspace", async () => {
    expect((await get("product-1.png")).status).toBe(404);
    expect((await remove("product-1.png")).status).toBe(200);

    expect(fs.existsSync(workspace)).toBe(false);
  });

  it("refuses a request that names something other than a stored image", async () => {
    expect((await get("../credential-vault.json")).status).toBe(404);
    expect((await get("notes.txt")).status).toBe(404);
    expect((await remove("publish-logs/shot.png")).status).toBe(400);
  });

  it("refuses an upload that is not a supported image", async () => {
    const response = await upload(new File(["notes"], "notes.txt", { type: "text/plain" }));

    expect(response.status).toBe(400);
    expect(fs.existsSync(workspace)).toBe(false);
  });
});
