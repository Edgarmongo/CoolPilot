import fs from "node:fs/promises";
import path from "node:path";
import { IMAGE_FILE_EXTENSIONS } from "@/lib/artifact-image-url";
import { artifactsRoot } from "@/lib/paths";

/** Lists the image files currently stored in the artifacts directory. */
export async function listArtifactImageFiles() {
  const files = await fs.readdir(artifactsRoot()).catch(() => [] as string[]);
  return files.filter((file) => IMAGE_FILE_EXTENSIONS.has(path.extname(file).toLowerCase()));
}

/**
 * Removes the named images from the artifacts directory. Names are reduced to
 * their basename and restricted to known image extensions, so a request can
 * never reach outside the artifacts root; unusable names are skipped instead of
 * failing the whole batch.
 */
export async function deleteArtifactImageFiles(fileNames: string[]) {
  const root = path.resolve(artifactsRoot());
  const deleted: string[] = [];
  for (const requested of fileNames) {
    const fileName = path.basename(requested);
    if (!requested || fileName !== requested) continue;
    if (!IMAGE_FILE_EXTENSIONS.has(path.extname(fileName).toLowerCase())) continue;
    try {
      await fs.rm(path.join(root, fileName), { force: true });
      deleted.push(fileName);
    } catch {
      // A locked or already-missing file must not abort the rest of the batch.
    }
  }
  return deleted;
}
