import zlib from "node:zlib";

/**
 * Self-contained text extraction for the "Upload file" import dialog.
 *
 * Plain-text formats (txt / md / csv / json / html / xml) are decoded directly.
 * Office Open XML formats (docx / xlsx / pptx) are ZIP archives, so their XML
 * parts are inflated with `zlib` and reduced to text. PDF text streams are
 * inflated best-effort. No third-party parser dependency is required.
 */

export const knowledgeUploadMaxBytes = 15 * 1024 * 1024;

const textExtensions = new Set(["txt", "md", "markdown", "csv", "tsv", "json", "log", "text", "html", "htm", "xml", "yaml", "yml"]);
const officeExtensions = new Set(["docx", "xlsx", "pptx"]);

export function knowledgeFileExtension(name: string) {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function isSupportedKnowledgeFile(name: string) {
  const ext = knowledgeFileExtension(name);
  return textExtensions.has(ext) || officeExtensions.has(ext) || ext === "pdf";
}

function decodeEntities(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function stripTags(xml: string) {
  return decodeEntities(xml.replace(/<[^>]*>/g, " "))
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ------------------------------------------------------------------ ZIP ---- */

type ZipEntry = { compression: number; dataStart: number; compressedSize: number };

function findEndOfCentralDirectory(buf: Buffer) {
  const start = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= start; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

function readZipEntries(buf: Buffer): Map<string, ZipEntry> | null {
  const eocd = findEndOfCentralDirectory(buf);
  if (eocd < 0) return null;
  const entryCount = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries = new Map<string, ZipEntry>();

  for (let i = 0; i < entryCount; i += 1) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) break;
    const compression = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLength);

    if (localOffset + 30 <= buf.length && buf.readUInt32LE(localOffset) === 0x04034b50) {
      const localNameLength = buf.readUInt16LE(localOffset + 26);
      const localExtraLength = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      entries.set(name, { compression, dataStart, compressedSize });
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipEntry(buf: Buffer, entry: ZipEntry): Buffer | null {
  const raw = buf.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
  try {
    if (entry.compression === 0) return raw;
    if (entry.compression === 8) return zlib.inflateRawSync(raw);
  } catch {
    return null;
  }
  return null;
}

function extractDocxText(buf: Buffer, entries: Map<string, ZipEntry>) {
  const doc = entries.get("word/document.xml");
  if (!doc) return "";
  const data = readZipEntry(buf, doc);
  if (!data) return "";
  const xml = data.toString("utf8");
  const withBreaks = xml
    .replace(/<w:tab\b[^>]*\/?>/g, "\t")
    .replace(/<w:br\b[^>]*\/?>/g, "\n")
    .replace(/<\/w:p>/g, "\n");
  return stripTags(withBreaks);
}

function extractXlsxText(buf: Buffer, entries: Map<string, ZipEntry>) {
  const shared = entries.get("xl/sharedStrings.xml");
  const lines: string[] = [];
  if (shared) {
    const data = readZipEntry(buf, shared);
    if (data) {
      const xml = data.toString("utf8");
      for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
        const value = stripTags(match[1].replace(/<\/t>/g, "\n"));
        if (value) lines.push(value);
      }
    }
  }
  for (const [name, entry] of entries) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue;
    const data = readZipEntry(buf, entry);
    if (!data) continue;
    const xml = data.toString("utf8");
    for (const match of xml.matchAll(/<v>([\s\S]*?)<\/v>/g)) {
      const value = decodeEntities(match[1]).trim();
      if (value) lines.push(value);
    }
  }
  return lines.join("\n").trim();
}

function extractPptxText(buf: Buffer, entries: Map<string, ZipEntry>) {
  const lines: string[] = [];
  for (const [name, entry] of entries) {
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(name)) continue;
    const data = readZipEntry(buf, entry);
    if (!data) continue;
    const xml = data.toString("utf8").replace(/<\/a:p>/g, "\n");
    const value = stripTags(xml);
    if (value) lines.push(value);
  }
  return lines.join("\n\n").trim();
}

/* ------------------------------------------------------------------ PDF ---- */

function decodePdfString(value: string) {
  return value
    .replace(/\\([nrtbf()\\])/g, (_, ch: string) => {
      const map: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
      return map[ch] ?? ch;
    })
    .replace(/\\([0-7]{1,3})/g, (_, oct: string) => String.fromCharCode(Number.parseInt(oct, 8)));
}

function textFromPdfContent(content: string) {
  const parts: string[] = [];
  for (const match of content.matchAll(/\((?:\\.|[^\\()])*\)\s*Tj/g)) {
    const inner = match[0].slice(1, match[0].lastIndexOf(")"));
    parts.push(decodePdfString(inner));
  }
  for (const match of content.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
    const line: string[] = [];
    for (const item of match[1].matchAll(/\((?:\\.|[^\\()])*\)/g)) {
      line.push(decodePdfString(item[0].slice(1, item[0].length - 1)));
    }
    parts.push(line.join(""));
  }
  return parts.join(" ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function extractPdfText(buf: Buffer) {
  const raw = buf.toString("latin1");
  const collected: string[] = [];
  for (const match of raw.matchAll(/stream\r?\n?([\s\S]*?)\r?\n?endstream/g)) {
    const body = Buffer.from(match[1], "latin1");
    let decoded = "";
    try {
      decoded = zlib.inflateSync(body).toString("latin1");
    } catch {
      decoded = match[1];
    }
    const text = textFromPdfContent(decoded);
    if (text) collected.push(text);
  }
  return collected.join("\n\n").trim();
}

/* ------------------------------------------------------------- dispatch ---- */

/** Extracts plain text from a supported knowledge-base upload. */
export function extractTextFromFile(name: string, data: Buffer): string {
  const ext = knowledgeFileExtension(name);
  if (officeExtensions.has(ext)) {
    const entries = readZipEntries(data);
    if (entries) {
      const text =
        ext === "docx"
          ? extractDocxText(data, entries)
          : ext === "xlsx"
            ? extractXlsxText(data, entries)
            : extractPptxText(data, entries);
      if (text) return text;
    }
  }
  if (ext === "pdf") {
    return extractPdfText(data);
  }
  if (ext === "html" || ext === "htm" || ext === "xml") {
    return stripTags(data.toString("utf8"));
  }
  return data.toString("utf8").replace(/\r\n/g, "\n").trim();
}
