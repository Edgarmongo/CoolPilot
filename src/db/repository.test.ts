import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * P5-B0-1.5: an account's browser profile is a workspace asset, not a path that happened to
 * be true on an earlier machine.
 *
 * `accounts.profile_path` is written once, when the account is created, as an absolute path
 * (`createAccount` -> `accountProfilePath(id)`), and the app launches Chromium on that
 * stored string: the login window, the preview session, the publish run panel and
 * the worker all read `AccountRecord.profilePath` and hand it to
 * `launchSiteProfileContext()` / `launchPersistentContext()`. Every one of them therefore
 * depended on a path that stays valid only for as long as the workspace never moves.
 *
 * The audited workspace is the proof. Its data folder was renamed to the product's current
 * name while the profiles moved with it (all five account ids and both unlinked ones are
 * directories under the open `web-data\browser-profiles`), and the only thing that did not
 * move is the string in the database. So a recovered account was visible again and still
 * unusable: Playwright would launch on a directory that does not exist and create an empty
 * one, and the user would be asked to log in to an account whose login state never left the
 * disk.
 *
 * What the user owns is the relationship - account id <-> `browser-profiles/<id>` inside
 * whatever workspace is open - so that is what these tests pin. They also pin the smaller
 * promise that comes with it: the stored value is kept as history (it is where this
 * account's profile lived when it was created) and is no longer trusted, rather than being
 * rewritten into a new absolute path by a migration that only works on this machine.
 *
 * `@/db/client` resolves its database URL and initialises it once per process, so this file
 * points both roots at a throwaway workspace before the module is imported and restores the
 * environment when it is done.
 */

/** The workspace this app is open on, and the moved one the stored values still name. */
const tempDir = mkdtempSync(path.join(tmpdir(), "coolpilot-accounts-"));
const workspace = path.join(tempDir, "CoolPilot", "web-data");
const legacyWorkspace = path.join(tempDir, "previous-workspace", "web-data");
const legacyProfiles = path.join(legacyWorkspace, "browser-profiles");

const previousDataDir = process.env.SOCIAL_AUTO_POST_DATA_DIR;
const previousDbUrl = process.env.SOCIAL_AUTO_POST_DB_URL;
process.env.SOCIAL_AUTO_POST_DATA_DIR = workspace;
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path
  .join(workspace, "social-auto-post.db")
  .replace(/\\/g, "/")}`;

let repository: typeof import("@/db/repository");
let sqlite: typeof import("@/db/client").sqlite;

/** The only path an account's browser profile may resolve to. */
function workspaceProfilePath(accountId: string) {
  return path.join(workspace, "browser-profiles", accountId);
}

/** A profile directory with a marker file, so a test can tell which copy was read. */
function createProfileDir(dir: string, marker: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "profile-marker.json"), JSON.stringify({ profile: marker }));
}

function markerOf(profilePath: string) {
  return JSON.parse(readFileSync(path.join(profilePath, "profile-marker.json"), "utf-8")).profile;
}

async function storedProfilePath(accountId: string) {
  const result = await sqlite.execute({
    sql: `SELECT profile_path FROM accounts WHERE id = ?`,
    args: [accountId],
  });
  return String(result.rows[0]?.profile_path ?? "");
}

/** An account as a pre-rename install wrote it: an absolute path under the old workspace. */
async function insertLegacyAccountRow(input: { id: string; name: string; profilePath: string }) {
  const timestamp = 1791276524345;
  await sqlite.execute({
    sql: `INSERT INTO accounts (id, name, platform, url, account, profile_path, memo, status, preset_json, created_at, updated_at)
          VALUES (?, ?, '小红书', '', '', ?, '', 'active', '{}', ?, ?)`,
    args: [input.id, input.name, input.profilePath, timestamp, timestamp],
  });
}

const LEGACY_ACCOUNT_ID = "Th2nOn6cCFEo6Ia8zGkyn";

beforeAll(async () => {
  repository = await import("@/db/repository");
  ({ sqlite } = await import("@/db/client"));
  // Migrations run on the first repository call, exactly like the app's first request.
  await repository.listAccounts();
});

afterAll(async () => {
  // The app never closes its own connection; Windows refuses to remove a file a live
  // SQLite handle still points at.
  await sqlite.close();
  if (previousDataDir === undefined) delete process.env.SOCIAL_AUTO_POST_DATA_DIR;
  else process.env.SOCIAL_AUTO_POST_DATA_DIR = previousDataDir;
  if (previousDbUrl === undefined) delete process.env.SOCIAL_AUTO_POST_DB_URL;
  else process.env.SOCIAL_AUTO_POST_DB_URL = previousDbUrl;
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // A throwaway folder the OS reclaims on its own.
  }
});

describe("account browser profiles", () => {
  it("resolves a new account to the profile directory of the open workspace", async () => {
    const account = await repository.createAccount({ name: "新帳號", platform: "小红书" });

    expect(account).not.toBeNull();
    expect(account!.profilePath).toBe(workspaceProfilePath(account!.id));
    // The account has never launched a browser, so nothing is created until Playwright does.
    expect(existsSync(workspaceProfilePath(account!.id))).toBe(false);
  });

  it("uses the profile in the open workspace when the stored path points at a moved one", async () => {
    // Both copies exist, which is the case that decides the design: the login state the user
    // wants is the one in the workspace they have open, and the old copy is left alone.
    createProfileDir(workspaceProfilePath(LEGACY_ACCOUNT_ID), "open-workspace");
    createProfileDir(path.join(legacyProfiles, LEGACY_ACCOUNT_ID), "moved-workspace");
    await insertLegacyAccountRow({
      id: LEGACY_ACCOUNT_ID,
      name: "CoolSkyAI编程",
      profilePath: path.join(legacyProfiles, LEGACY_ACCOUNT_ID),
    });

    const before = readdirSync(path.join(workspace, "browser-profiles")).sort();
    const account = await repository.getAccount(LEGACY_ACCOUNT_ID);
    const after = readdirSync(path.join(workspace, "browser-profiles")).sort();

    expect(account!.profilePath).toBe(workspaceProfilePath(LEGACY_ACCOUNT_ID));
    // The existing profile is the one that gets used - not a fresh, logged-out copy.
    expect(markerOf(account!.profilePath)).toBe("open-workspace");
    expect(after).toEqual(before);
    // The moved workspace is not consulted, moved or emptied on the way.
    expect(markerOf(path.join(legacyProfiles, LEGACY_ACCOUNT_ID))).toBe("moved-workspace");
  });

  it("resolves an account whose profile does not exist yet without creating it", async () => {
    const accountId = "dsaTU2MY7vc6mqW-39RdG";
    await insertLegacyAccountRow({
      id: accountId,
      name: "头条号",
      profilePath: path.join(legacyProfiles, accountId),
    });

    const account = await repository.getAccount(accountId);

    // Playwright creates the directory when the account is first opened, so it must not
    // exist before that - an empty profile that exists is one the user never logged into.
    expect(account!.profilePath).toBe(workspaceProfilePath(accountId));
    expect(existsSync(account!.profilePath)).toBe(false);
  });

  it("keeps account id and profile directory in step for every account", async () => {
    const { browserProfilesRoot } = await import("@/lib/paths");
    const account = await repository.createAccount({ name: "小紅書主帳號", platform: "小红书" });
    const accounts = await repository.listAccounts();

    expect(accounts.length).toBeGreaterThanOrEqual(4);
    expect(account).not.toBeNull();
    for (const record of accounts) {
      expect(record.profilePath).toBe(path.join(browserProfilesRoot(), record.id));
      expect(path.basename(record.profilePath)).toBe(record.id);
    }
  });

  it("keeps the stored path as history instead of rewriting the database", async () => {
    // The column is what a user's workspace looked like before it moved: worth keeping, and
    // worth not trusting. A migration that rewrote it would be a claim about one machine.
    expect(await storedProfilePath(LEGACY_ACCOUNT_ID)).toBe(
      path.join(legacyProfiles, LEGACY_ACCOUNT_ID),
    );
  });

  it("does not let an account edit write a profile path again", async () => {
    const updated = await repository.updateAccount(LEGACY_ACCOUNT_ID, {
      name: "CoolSkyAI编程（小紅書）",
      profilePath: path.join(legacyProfiles, "somewhere-else"),
    });

    expect(updated!.name).toBe("CoolSkyAI编程（小紅書）");
    expect(updated!.profilePath).toBe(workspaceProfilePath(LEGACY_ACCOUNT_ID));
    expect(await storedProfilePath(LEGACY_ACCOUNT_ID)).toBe(
      path.join(legacyProfiles, LEGACY_ACCOUNT_ID),
    );
  });
});
