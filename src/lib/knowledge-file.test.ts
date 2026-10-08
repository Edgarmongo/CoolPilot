import { describe, expect, it } from "vitest";
import { extractTextFromFile, isSupportedKnowledgeFile, knowledgeFileExtension } from "./knowledge-file";

/** Builds a minimal ZIP with stored (uncompressed) entries, for docx/xlsx tests. */
function buildStoredZip(files: Record<string, string>): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const names = Object.keys(files);

  for (const name of names) {
    const data = Buffer.from(files[name], "utf8");
    const nameBuf = Buffer.from(name, "utf8");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, data);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt32LE(0, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(names.length, 8);
  eocd.writeUInt16LE(names.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

describe("knowledge file extraction", () => {
  it("resolves extensions and supported types", () => {
    expect(knowledgeFileExtension("Report.DOCX")).toBe("docx");
    expect(isSupportedKnowledgeFile("a.pdf")).toBe(true);
    expect(isSupportedKnowledgeFile("a.md")).toBe(true);
    expect(isSupportedKnowledgeFile("a.exe")).toBe(false);
  });

  it("extracts text from plain-text and html files", () => {
    expect(extractTextFromFile("notes.txt", Buffer.from("hello\nworld", "utf8"))).toBe("hello\nworld");
    expect(extractTextFromFile("page.html", Buffer.from("<p>Title</p><br/>Body", "utf8"))).toContain("Title");
  });

  it("extracts text from a docx archive", () => {
    const zip = buildStoredZip({
      "word/document.xml":
        "<w:document><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p><w:p><w:r><w:t>World</w:t></w:r></w:p></w:body></w:document>",
    });
    const text = extractTextFromFile("entry.docx", zip);
    expect(text).toContain("Hello");
    expect(text).toContain("World");
  });

  it("extracts text from an xlsx archive", () => {
    const zip = buildStoredZip({
      "xl/sharedStrings.xml":
        '<sst><si><t>Apple</t></si><si><t>Banana</t></si></sst>',
      "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row><c><v>42</v></c></row></sheetData></worksheet>',
    });
    const text = extractTextFromFile("items.xlsx", zip);
    expect(text).toContain("Apple");
    expect(text).toContain("Banana");
    expect(text).toContain("42");
  });

  it("returns empty text for unreadable binary content", () => {
    expect(extractTextFromFile("broken.pdf", Buffer.from("not a real pdf", "utf8"))).toBe("");
  });
});
