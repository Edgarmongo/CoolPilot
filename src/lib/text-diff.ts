/**
 * Tiny dependency-free paragraph diff used by the AI dialogs.
 *
 * Generated text must be reviewed against the current body before it replaces
 * it, so this produces the line/paragraph level diff that powers the
 * “差异高亮” side-by-side view.
 */

export type DiffLine = {
  type: "same" | "added" | "removed";
  text: string;
};

/** Guards the quadratic LCS table for pathologically long documents. */
const MAX_LCS_CELLS = 400_000;

/** Splits text into trimmed, non-empty lines (paragraphs). */
export function toDiffLines(value: string): string[] {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function lcsTable(a: string[], b: string[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

/** Fallback for very long texts: compare line by line instead of by LCS. */
function diffByPosition(a: string[], b: string[]): DiffLine[] {
  const lines: DiffLine[] = [];
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const before = a[index];
    const after = b[index];
    if (before === after) {
      lines.push({ type: "same", text: before ?? "" });
      continue;
    }
    if (before !== undefined) lines.push({ type: "removed", text: before });
    if (after !== undefined) lines.push({ type: "added", text: after });
  }
  return lines;
}

/** Line/paragraph level diff between two texts. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = toDiffLines(before);
  const b = toDiffLines(after);
  if (a.length * b.length > MAX_LCS_CELLS) return diffByPosition(a, b);

  const table = lcsTable(a, b);
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ type: "same", text: a[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push({ type: "removed", text: a[i] });
      i += 1;
    } else {
      lines.push({ type: "added", text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) {
    lines.push({ type: "removed", text: a[i] });
    i += 1;
  }
  while (j < b.length) {
    lines.push({ type: "added", text: b[j] });
    j += 1;
  }
  return lines;
}

/** Splits a diff into the two panes of a side-by-side comparison. */
export function toSideBySide(lines: DiffLine[]): { left: DiffLine[]; right: DiffLine[] } {
  return {
    left: lines.filter((line) => line.type !== "added"),
    right: lines.filter((line) => line.type !== "removed"),
  };
}

/** Number of paragraphs that differ. */
export function diffChangeCount(lines: DiffLine[]): number {
  return lines.filter((line) => line.type !== "same").length;
}
