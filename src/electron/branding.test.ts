import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function readProjectFile(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}
const SCANNED_DIRECTORIES = ["src", "electron", "scripts", "docs"];
const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs", ".json", ".md", ".yml", ".yaml"]);
const SCANNED_ROOT_FILES = [
  "package.json",
  "electron-builder.yml",
  ".env.example",
  "README.md",
  "README.zh-TW.md",
];

function collectSourceFiles(directory: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      collectSourceFiles(fullPath, found);
    } else if (SCANNED_EXTENSIONS.has(path.extname(entry.name))) {
      found.push(fullPath);
    }
  }
  return found;
}

function collectBrandSensitiveFiles() {
  const sourceFiles = SCANNED_DIRECTORIES.flatMap((directory) =>
    collectSourceFiles(path.join(root, directory)),
  );
  const rootFiles = SCANNED_ROOT_FILES.map((file) => path.join(root, file)).filter((file) =>
    fs.existsSync(file),
  );
  return [...sourceFiles, ...rootFiles];
}


/**
 * Product names this project used before `CoolPilot`, assembled from fragments so the guard
 * below also scans its own file without matching itself.
 */
const PREVIOUS_PRODUCT_NAMES = ["sme" + "post", "meo" + "wus"] as const;

function hasPreviousProductName(content: string) {
  return PREVIOUS_PRODUCT_NAMES.some((name) => new RegExp(name, "i").test(content));
}

describe("Electron and web branding", () => {
  it("uses the rocket brand logo for app and website icons", () => {
    const iconGenerator = readProjectFile("scripts/generate-icons.ts");
    expect(iconGenerator).toContain('path.join(root, "public", "logo.webp")');
    expect(iconGenerator).toContain('path.join(root, "public", "favicon.ico")');
    expect(iconGenerator).toContain('path.join(buildDir, "icon.ico")');
    expect(iconGenerator).toContain('path.join(buildDir, "icon.png")');

    const packageJson = readProjectFile("package.json");
    expect(packageJson).toContain('"build": "pnpm icons:generate && next build"');

    const rootLayout = readProjectFile("src/app/layout.tsx");
    expect(rootLayout).toContain('icon: "/favicon.ico"');

    const electronBuilderConfig = readProjectFile("electron-builder.yml");
    expect(electronBuilderConfig).toContain("icon: build/icon.ico");

    const electronMain = readProjectFile("electron/main.cjs");
    expect(electronMain).toContain('icon: path.join(__dirname, "..", "build", "icon.png")');
  });

  it("disables the default Electron menu that exposes developer tools", () => {
    const electronMain = readProjectFile("electron/main.cjs");
    expect(electronMain).toContain("Menu.setApplicationMenu(null)");
  });

  it("keeps release signing scoped to macOS and pins the branded data folder", () => {
    const electronBuilderConfig = readProjectFile("electron-builder.yml");
    expect(electronBuilderConfig).toContain("appId: io.coolpilot.app");
    expect(electronBuilderConfig).toContain("- dmg");
    expect(electronBuilderConfig).toContain("- nsis");
    expect(electronBuilderConfig).toContain("hardenedRuntime: true");
    expect(electronBuilderConfig).not.toContain("identity: null");

    const packageJson = readProjectFile("package.json");
    expect(packageJson).toContain('"electron:build:win"');
    expect(packageJson).toContain('"electron:build:mac"');
    expect(packageJson).toContain('"electron:build:store"');
    expect(packageJson).toContain('"electron:build:win": "pnpm build && tsx scripts/prepare-electron-bundle.ts && electron-builder --win --publish never"');

    const storeBuild = readProjectFile("scripts/build-store-package.ts");
    expect(storeBuild).toContain('"MS_STORE_IDENTITY_NAME"');
    expect(storeBuild).toContain('"MS_STORE_PUBLISHER"');
    expect(storeBuild).toContain('"appx"');
    expect(storeBuild).toContain('CSC_IDENTITY_AUTO_DISCOVERY: "false"');

    const electronMain = readProjectFile("electron/main.cjs");
    expect(electronMain).toContain("const USER_DATA_FOLDER = PRODUCT_SHORT_NAME");

    const runtimeConfig = readProjectFile("src/lib/runtime-config.ts");
    expect(runtimeConfig).toContain('import { PRODUCT_SHORT_NAME } from "./product-branding"');
    expect(runtimeConfig).toContain("export const APP_DATA_FOLDER_NAME = PRODUCT_SHORT_NAME");
  });

  it("contains no previous product name anywhere in the project", () => {
    const offenders = collectBrandSensitiveFiles()
      .filter((file) => hasPreviousProductName(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(root, file).replace(/\\/g, "/"));

    expect(offenders).toEqual([]);
  });
});
