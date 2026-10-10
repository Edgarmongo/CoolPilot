import path from "node:path";
import { mkdirSync } from "node:fs";
import { resolveAppDataDir } from "@/lib/runtime-config";

/**
 * P5-B0-2.5: the workspace boundary, in two layers.
 *
 * **Resolving** a path computes it and touches nothing. Every accessor without an `ensure` prefix
 * below is pure, so a reader - a listing, an inventory, a `GET` - can ask where something lives
 * without bringing it into existence. That is what a read is, and it is what the inventory of
 * P5-B0-2 spelled the whole layout out a second time to avoid.
 *
 * **Initializing** a path creates it, and only a writer that needs a directory to exist asks for
 * one: `ensureDataRoot()`, `ensureBrowserProfilesRoot()`, `ensureArtifactsRoot()`,
 * `ensureVideosRoot()`, `ensureMediaRoot()`, `ensureProductImagesRoot()`, `ensureBrandLogosRoot()`.
 * Pairing the two at
 * the write rather than inside the accessor is also what keeps a `GET` from leaving an empty
 * section behind in a workspace that has none.
 *
 * `uploadsRoot()` has no initializer of its own because nothing writes directly into `uploads/`:
 * the two sections under it are initialized by their own writers, which create it as their parent.
 */
export function appRoot() {
  return process.cwd();
}

/** The workspace this app is open on. Resolution only - a writer calls `ensureDataRoot()`. */
export function dataRoot() {
  return resolveAppDataDir();
}

export function ensureDataRoot() {
  return initialize(dataRoot());
}

/** The section an account's persistent browser profile lives in. */
export function browserProfilesRoot() {
  return path.join(dataRoot(), "browser-profiles");
}

export function ensureBrowserProfilesRoot() {
  return initialize(browserProfilesRoot());
}

/** Creates a directory a writer is about to fill, and answers the path it was given. */
function initialize(directory: string) {
  mkdirSync(directory, { recursive: true });
  return directory;
}

/**
 * P5-B0-1.5: where an account's browser profile lives, derived from the account and the
 * workspace that is open rather than from `accounts.profile_path`.
 *
 * That column is written once, when the account is created, and used to be read back
 * verbatim by every launch site, so a workspace whose data folder was renamed left every
 * account pointing at a directory that no longer exists: the login state was on disk the
 * whole time and the app could not find it, which is what a recovered account would have
 * been launched into. Deriving the path instead keeps the relationship the user owns -
 * account id <-> `browser-profiles/<id>` in the current workspace - and leaves the stored
 * value where it belongs, as history.
 *
 * Deliberately does not create the directory: Playwright creates a persistent context's
 * profile when an account is first opened, and an empty profile that exists is one the user
 * has never logged into. There is no `ensureAccountProfilePath()` either, and the read path
 * that made a directory per account on every listing (`toAccount()`) no longer can
 * (P5-B0-2.5): a launcher initializes the section with `ensureBrowserProfilesRoot()`, and the
 * profile itself is left to whoever opens the account.
 */
export function accountProfilePath(accountId: string) {
  return path.join(browserProfilesRoot(), accountId);
}

/**
 * The section for files a user uploads. It has no initializer of its own: `product-images` and
 * `brand-logos` are written by their own routes, and each initializer creates this as its parent.
 */
export function uploadsRoot() {
  return path.join(dataRoot(), "uploads");
}

/** The section for generated and uploaded images the agent, the editor and the writer share. */
export function artifactsRoot() {
  return path.join(dataRoot(), "artifacts");
}

export function ensureArtifactsRoot() {
  return initialize(artifactsRoot());
}

/** The section for videos uploaded for publishing. */
export function videosRoot() {
  return path.join(dataRoot(), "videos");
}

export function ensureVideosRoot() {
  return initialize(videosRoot());
}

/**
 * The section for audio and video a user imported as transcription input (CI-P3-02).
 *
 * It is a section of its own rather than a corner of `videos/` for one reason the product cares about:
 * `videos/` is the library of *publishable* videos, and a talk imported to be transcribed is not a
 * candidate for publishing until someone decides it is - so mixing the two would make every
 * transcription import appear in the publishing composer's picker.
 */
export function mediaRoot() {
  return path.join(dataRoot(), "media");
}

export function ensureMediaRoot() {
  return initialize(mediaRoot());
}

/** The product photos a user uploaded, inside the uploads section. */
export function productImagesRoot() {
  return path.join(uploadsRoot(), "product-images");
}

export function ensureProductImagesRoot() {
  return initialize(productImagesRoot());
}

/** The brand logos a user uploaded, inside the uploads section. */
export function brandLogosRoot() {
  return path.join(uploadsRoot(), "brand-logos");
}

export function ensureBrandLogosRoot() {
  return initialize(brandLogosRoot());
}

export function normalizeFileUrl(fileUrl: string) {
  if (!fileUrl.startsWith("file:")) {
    return fileUrl;
  }
  const value = fileUrl.slice("file:".length);
  const resolved = path.isAbsolute(value)
    ? value
    : path.resolve(/*turbopackIgnore: true*/ process.cwd(), value);
  return `file:${resolved.replace(/\\/g, "/")}`;
}
