import path from "node:path";
import { mkdirSync } from "node:fs";
import { resolveAppDataDir } from "@/lib/runtime-config";

export function appRoot() {
  return process.cwd();
}

export function dataRoot() {
  const root = resolveAppDataDir();
  mkdirSync(root, { recursive: true });
  return root;
}

export function browserProfilesRoot() {
  const root = path.join(dataRoot(), "browser-profiles");
  mkdirSync(root, { recursive: true });
  return root;
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
 * has never logged into.
 */
export function accountProfilePath(accountId: string) {
  return path.join(browserProfilesRoot(), accountId);
}

export function uploadsRoot() {
  const root = path.join(dataRoot(), "uploads");
  mkdirSync(root, { recursive: true });
  return root;
}

export function artifactsRoot() {
  const root = path.join(dataRoot(), "artifacts");
  mkdirSync(root, { recursive: true });
  return root;
}

export function videosRoot() {
  const root = path.join(dataRoot(), "videos");
  mkdirSync(root, { recursive: true });
  return root;
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
