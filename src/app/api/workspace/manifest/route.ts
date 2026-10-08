import { failFromError, ok } from "@/lib/api";
import { createWorkspaceManifest } from "@/lib/workspace/manifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * P5-B0-3: `createWorkspaceManifest()` over HTTP, and nothing else.
 *
 * The report is complete before this handler is reached: nothing here queries the database, walks
 * a directory, or decides whether a file is an artifact content references or one nothing does.
 * Those questions - and the answer to "what if the workspace is broken" - belong to
 * `@/lib/workspace/manifest`, and a second answer composed at the HTTP layer would be a policy for
 * the same facts that can disagree with the first one. A workspace with no database, a database
 * file that is not a database (P5-B0-2: `SQLITE_NOTADB` on a stray file), an unreadable profile
 * file and an absent `uploads/` are all *described* by the manifest as smaller numbers, so all of
 * them are `200` here. There is deliberately no `existsSync(root)` guard and no `404`: "this
 * workspace does not exist" is the first thing the report was written to be able to say, and a
 * status code decided here would make the console learn which failures the manifest absorbs.
 *
 * It is also a `GET` that cannot create what it describes. Every section comes from the pure
 * accessors of `@/lib/paths`, and the database file is opened only once it is known to be there
 * (P5-B0-2.5), so asking for the overview of an empty install leaves no `artifacts/`, no `videos/`
 * and no database behind. That is what makes the route safe to call before the user has created
 * anything, which is precisely when someone reads an overview.
 *
 * `force-dynamic` because the report describes the workspace *this process* has open: the
 * workspace is chosen at launch (packaged builds: `APP_DATA_DIR`), and a report evaluated once at
 * build time would describe the machine that built the app instead - naming a root the user never
 * had, with the numbers of a workspace that is not theirs.
 *
 * The one failure that leaves through `failFromError` is a broken manifest - a bug rather than a
 * fact about the workspace - answered in the standard error shape, never as a partial report that
 * reads like a workspace which lost its files.
 */
export async function GET() {
  try {
    return ok(await createWorkspaceManifest());
  } catch (error) {
    return failFromError(error);
  }
}
