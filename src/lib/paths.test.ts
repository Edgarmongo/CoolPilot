import fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { listArtifactImageFiles } from "@/lib/image-library";
import { createPublishLog, getPublishDebugLog, setPublishDebugEnabled } from "@/lib/publish-debug";
import { createWorkspaceManifest } from "@/lib/workspace/manifest";
import {
  accountProfilePath,
  artifactsRoot,
  brandLogosRoot,
  browserProfilesRoot,
  dataRoot,
  ensureArtifactsRoot,
  ensureBrandLogosRoot,
  ensureBrowserProfilesRoot,
  ensureDataRoot,
  ensureProductImagesRoot,
  ensureVideosRoot,
  productImagesRoot,
  uploadsRoot,
  videosRoot,
} from "./paths";
import { resolveAppDataDir } from "./runtime-config";

/**
 * P5-B0-2.5: the workspace boundary is two halves, and the difference between them is the point of
 * this file.
 *
 *   - **Resolving** a path computes it and touches nothing. `dataRoot()`, `artifactsRoot()`,
 *     `uploadsRoot()`, `videosRoot()`, `browserProfilesRoot()`, `productImagesRoot()`,
 *     `brandLogosRoot()` and `accountProfilePath()` are pure, so listing the artifacts, streaming a
 *     video or taking an inventory can ask where something lives without bringing it into
 *     existence.
 *   - **Initializing** a path creates it, and only the writers that need a directory to exist ask
 *     for one: `ensureDataRoot()`, `ensureArtifactsRoot()`, `ensureVideosRoot()`,
 *     `ensureBrowserProfilesRoot()`, `ensureProductImagesRoot()`, `ensureBrandLogosRoot()`. There is
 *     deliberately no `ensureAccountProfilePath()` - Playwright creates a persistent profile when an
 *     account is first opened, and a profile that exists but was never logged into is a worse
 *     answer than a missing one (P5-B0-1.5).
 *
 * Until this batch every accessor did both, which cost three real things: listing the images in
 * `artifacts/` created `artifacts/`, a `GET` of the video library created `videos/`, and - the one
 * that shows the size of it - `toAccount()` resolves `profilePath` through `accountProfilePath()` on
 * every read, so merely listing accounts created `browser-profiles/` for accounts that had never
 * been opened. `manifest.ts` (P5-B0-2) worked around it by spelling the layout out a second time,
 * and `agent/artifacts/route.ts` had a third copy that did not know about `APP_DATA_DIR` at all.
 *
 * What the boundary hands out, then, is one place per name, and the scan at the end of this file is
 * what keeps it that way: a module that wants to know where `artifacts` is asks `@/lib/paths`
 * instead of writing the name down again.
 */

let parent = "";
/** A workspace that does not exist yet: the only state in which "did it create anything" reads. */
let workspace = "";

const previousDataDir = process.env.SOCIAL_AUTO_POST_DATA_DIR;
const previousAppDataDir = process.env.APP_DATA_DIR;

beforeEach(() => {
  parent = mkdtempSync(path.join(tmpdir(), "coolpilot-boundary-"));
  workspace = path.join(parent, "workspace");
  process.env.SOCIAL_AUTO_POST_DATA_DIR = workspace;
  delete process.env.APP_DATA_DIR;
  setPublishDebugEnabled(null);
});

afterEach(() => {
  setPublishDebugEnabled(null);
  rmSync(parent, { recursive: true, force: true });
});

afterAll(() => {
  for (const [name, value] of [
    ["SOCIAL_AUTO_POST_DATA_DIR", previousDataDir],
    ["APP_DATA_DIR", previousAppDataDir],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("workspace path boundary", () => {
  describe("resolving a path", () => {
    it("computes the whole layout without bringing any part of it into existence", () => {
      const resolved = [
        dataRoot(),
        artifactsRoot(),
        uploadsRoot(),
        videosRoot(),
        browserProfilesRoot(),
        productImagesRoot(),
        brandLogosRoot(),
        accountProfilePath("acc-1"),
      ];

      for (const entry of resolved) {
        expect(entry === workspace || entry.startsWith(`${workspace}${path.sep}`)).toBe(true);
      }
      expect(fs.existsSync(workspace)).toBe(false);
      // Not just the workspace: nothing was left in the folder that would have held it.
      expect(fs.readdirSync(parent)).toEqual([]);
    });

    it("names each root the way the rest of the app means it", () => {
      expect(dataRoot()).toBe(resolveAppDataDir());
      expect(artifactsRoot()).toBe(path.join(workspace, "artifacts"));
      expect(uploadsRoot()).toBe(path.join(workspace, "uploads"));
      expect(videosRoot()).toBe(path.join(workspace, "videos"));
      expect(browserProfilesRoot()).toBe(path.join(workspace, "browser-profiles"));
      expect(accountProfilePath("acc-1")).toBe(path.join(browserProfilesRoot(), "acc-1"));
      // The two upload sections belong to `uploads/`, and the manifest reports them from here.
      expect(productImagesRoot()).toBe(path.join(uploadsRoot(), "product-images"));
      expect(brandLogosRoot()).toBe(path.join(uploadsRoot(), "brand-logos"));
    });

    it("resolves the profile of an account that has never been opened without creating it", () => {
      expect(accountProfilePath("acc-1")).toBe(path.join(browserProfilesRoot(), "acc-1"));
      expect(fs.existsSync(browserProfilesRoot())).toBe(false);
    });
  });

  describe("initializing a directory", () => {
    const sections = [
      { name: "artifacts", ensure: ensureArtifactsRoot, root: artifactsRoot },
      { name: "videos", ensure: ensureVideosRoot, root: videosRoot },
      { name: "browser-profiles", ensure: ensureBrowserProfilesRoot, root: browserProfilesRoot },
    ];

    it("creates the root when a writer asks for it", () => {
      expect(ensureDataRoot()).toBe(workspace);
      expect(fs.statSync(workspace).isDirectory()).toBe(true);
    });

    it("creates exactly the section that was initialized, and no sibling", () => {
      for (const section of sections) {
        rmSync(workspace, { recursive: true, force: true });

        expect(section.ensure()).toBe(section.root());
        expect(fs.statSync(section.root()).isDirectory()).toBe(true);
        expect(fs.readdirSync(workspace)).toEqual([section.name]);
      }
    });

    it("creates the upload sections together with the parent they live in", () => {
      expect(ensureProductImagesRoot()).toBe(productImagesRoot());
      expect(fs.readdirSync(workspace)).toEqual(["uploads"]);
      expect(fs.readdirSync(uploadsRoot())).toEqual(["product-images"]);

      rmSync(workspace, { recursive: true, force: true });

      expect(ensureBrandLogosRoot()).toBe(brandLogosRoot());
      expect(fs.readdirSync(workspace)).toEqual(["uploads"]);
      expect(fs.readdirSync(uploadsRoot())).toEqual(["brand-logos"]);
    });

    it("initializes the section a profile lives in without creating any account's profile", () => {
      ensureBrowserProfilesRoot();
      accountProfilePath("acc-1");

      expect(fs.existsSync(path.join(browserProfilesRoot(), "acc-1"))).toBe(false);
    });
  });

  describe("reading the workspace", () => {
    it("does not initialize it for the image library", async () => {
      expect(await listArtifactImageFiles()).toEqual([]);
      expect(fs.existsSync(workspace)).toBe(false);
    });

    it("does not initialize it for the manifest, and both agree on what a section is", async () => {
      const before = await createWorkspaceManifest();
      expect(before.root).toBe(workspace);
      expect(before.artifacts.fileCount).toBe(0);
      expect(before.videos.exists).toBe(false);
      expect(before.uploads.exists).toBe(false);
      expect(fs.existsSync(workspace)).toBe(false);

      // Initializing a section is what makes the next read report it, which can only hold while the
      // inventory and the boundary describe the same directory.
      ensureVideosRoot();
      const after = await createWorkspaceManifest();

      expect(after.videos.exists).toBe(true);
      expect(after.uploads.exists).toBe(false);
      expect(fs.readdirSync(workspace)).toEqual(["videos"]);
    });
  });

  describe("publish logs", () => {
    it("keeps a publish run from initializing the workspace while debug logging is off", () => {
      setPublishDebugEnabled(false);

      createPublishLog("acc-1").step("opened the composer");

      expect(fs.existsSync(artifactsRoot())).toBe(false);
    });

    it("writes the log into the artifacts section once debug logging is on", () => {
      setPublishDebugEnabled(true);

      createPublishLog("acc-1").step("opened the composer");

      const file = getPublishDebugLog("acc-1").file;
      expect(file.startsWith(`${path.join(artifactsRoot(), "publish-logs")}${path.sep}`)).toBe(true);
      expect(fs.readFileSync(file, "utf-8")).toContain("opened the composer");
      expect(fs.readdirSync(workspace)).toEqual(["artifacts"]);
    });
  });

  describe("the layout has one owner per name", () => {
    it("is joined by the module that owns the name, and by no other module", () => {
      const projectRoot = process.cwd();
      expect(fs.existsSync(path.join(projectRoot, "src", "lib", "paths.ts"))).toBe(true);

      const offenders: string[] = [];
      for (const file of sourceFiles(path.join(projectRoot, "src"))) {
        const relative = path.relative(projectRoot, file).split(path.sep).join("/");
        for (const args of pathCallArguments(fs.readFileSync(file, "utf-8"))) {
          for (const [name, owners] of Object.entries(LAYOUT_NAME_OWNERS)) {
            if (!args.includes(`"${name}"`) && !args.includes(`'${name}'`)) continue;
            if (!owners.includes(relative)) offenders.push(`${relative}: ${name}`);
          }
        }
      }

      expect(offenders).toEqual([]);
    });
  });
});

/**
 * Which module may write each name of the layout down as part of a path. `paths.ts` owns the four
 * sections and the two upload sections under them; `publish-logs` is the one nested directory a
 * feature module owns itself; and the folder that holds a workspace is decided by
 * `runtime-config.ts`, with the portable folder of a packaged app picked by the Electron side before
 * any of the app code runs.
 */
const LAYOUT_NAME_OWNERS: Record<string, string[]> = {
  "web-data": ["src/lib/runtime-config.ts", "src/electron/server-runtime.ts"],
  "browser-profiles": ["src/lib/paths.ts"],
  artifacts: ["src/lib/paths.ts"],
  uploads: ["src/lib/paths.ts"],
  videos: ["src/lib/paths.ts"],
  "product-images": ["src/lib/paths.ts"],
  "brand-logos": ["src/lib/paths.ts"],
  "publish-logs": ["src/lib/publish-debug.ts"],
};

/** One `path.join` / `path.resolve` / `path.dirname` call, allowing one level of nested calls. */
const PATH_CALL = /path\.(?:join|resolve|dirname)\(((?:[^()]|\([^()]*\))*)\)/g;

/**
 * The arguments of every path call in a file, with whitespace flattened, so a call whose arguments
 * sit on the following line still reads as one call.
 */
function pathCallArguments(content: string) {
  const flattened = content.replace(/\s+/g, " ");
  return [...flattened.matchAll(PATH_CALL)].map((match) => match[1]);
}

/** Every non-test TypeScript source file under a directory. */
function sourceFiles(directory: string, found: string[] = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      sourceFiles(fullPath, found);
      continue;
    }
    const isTest = entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx");
    if (!isTest && [".ts", ".tsx"].includes(path.extname(entry.name))) found.push(fullPath);
  }
  return found;
}
