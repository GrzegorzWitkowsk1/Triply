import { describe, expect, it, vi } from "vitest";
import PDFDocument from "pdfkit";
import { createRequire } from "node:module";
import { ATTACHMENT_LIMITS as L } from "@triply/shared";
import { extractAttachments, extractPdf, extractTxt } from "./attachmentExtraction.js";

const require = createRequire(import.meta.url);
async function pdf(text: string, pages = 1, encrypted = false): Promise<Buffer> {
  const doc = new PDFDocument({ autoFirstPage: false, ...(encrypted ? { userPassword: "private" } : {}) });
  const result = new Promise<Buffer>((resolve, reject) => { const chunks: Buffer[] = []; doc.on("data", chunk => chunks.push(chunk)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });
  for (let i = 0; i < pages; i++) {
    doc.addPage();
    for (const part of text.match(/[^\x00-\xff]+|[\x00-\xff]+/g) ?? []) {
      doc.font(require.resolve(`@fontsource/noto-sans/files/noto-sans-${/[^\x00-\xff]/.test(part) ? "latin-ext" : "latin"}-400-normal.woff`)).text(part, { continued: true });
    }
    if (text) doc.text("");
  }
  doc.end(); return result;
}
const file = (bytes: Buffer, name = "preferences.txt", type = "text/plain") => ({ bytes, name, type });

describe("bounded attachment extraction", () => {
  it.each(["Local food\nParks", "\uFEFFZażółć gęślą jaźń", "Rome\r\nMuseums"]) ("decodes UTF-8 and normalizes structure: %s", text => {
    expect(extractTxt(Buffer.from(text))).toBe(text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n"));
  });
  it.each(["", " \n\t"]) ("rejects empty text", text => expect(() => extractTxt(Buffer.from(text))).toThrow());
  it.each([Buffer.from([0xff, 0xfe]), Buffer.from("Rome\0hidden"), Buffer.from([1, 2, 3])])("rejects encoding and binary input", bytes => expect(() => extractTxt(bytes)).toThrow());
  it("rejects excessive text without truncating", () => expect(() => extractTxt(Buffer.from("x".repeat(L.textCharacters + 1)))).toThrow());
  it("extracts real multipage Unicode PDFs in an isolated worker", async () => {
    const text = await extractPdf(await pdf("Zażółć Rome Colosseum", 2));
    expect(text.match(/Colosseum/g)).toHaveLength(2); expect(text).toContain("Zażółć");
  });
  it("rejects image-only/empty PDFs", async () => await expect(extractPdf(await pdf(""))).rejects.toMatchObject({ code: "ATTACHMENT_SCANNED_PDF" }));
  it("rejects encrypted PDFs", async () => await expect(extractPdf(await pdf("Private", 1, true))).rejects.toMatchObject({ code: "ATTACHMENT_ENCRYPTED_PDF" }));
  it("rejects corrupted PDFs", async () => await expect(extractPdf(Buffer.from("%PDF-1.7 broken"))).rejects.toMatchObject({ code: "ATTACHMENT_INVALID_PDF" }));
  it("rejects excessive PDF pages", async () => await expect(extractPdf(await pdf("Rome", 21))).rejects.toMatchObject({ code: "ATTACHMENT_PAGES" }));
  it("rejects excessive PDF text", async () => await expect(extractPdf(await pdf("Rome ".repeat(2100)))).rejects.toMatchObject({ code: "ATTACHMENT_TEXT_LIMIT" }));
  it("terminates timed-out workers and releases pool capacity", async () => {
    const bytes = await pdf("Rome");
    await expect(extractPdf(bytes, undefined, 1)).rejects.toMatchObject({ code: "ATTACHMENT_TIMEOUT" });
    await expect(extractPdf(bytes)).resolves.toContain("Rome");
  });
  it("cancels workers on caller abort and releases resources", async () => {
    const controller = new AbortController(); const bytes = await pdf("Rome");
    const pending = extractPdf(bytes, controller.signal); controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "ATTACHMENT_TIMEOUT" });
    await expect(extractPdf(bytes)).resolves.toContain("Rome");
  });
  it("does not queue unlimited PDF jobs", async () => {
    const bytes = await pdf("Rome"); const first = extractPdf(bytes), second = extractPdf(bytes);
    await expect(extractPdf(bytes)).rejects.toMatchObject({ code: "ATTACHMENT_BUSY" });
    await Promise.all([first, second]);
  });
  it("accepts several distinct files without logging private content", async () => {
    const spy = vi.spyOn(console, "error");
    await expect(extractAttachments([file(Buffer.from("Private Rome")), file(Buffer.from("Food"), "food.txt")])).resolves.toEqual(["Private Rome", "Food"]);
    expect(spy).not.toHaveBeenCalled(); spy.mockRestore();
  });
  it("detects duplicate bytes even with different filenames", async () => await expect(extractAttachments([file(Buffer.from("Rome")), file(Buffer.from("Rome"), "other.txt")])).rejects.toMatchObject({ failures: [{ index: 1, code: "ATTACHMENT_DUPLICATE" }] }));
  it.each([
    [file(Buffer.from("%PDF- broken"), "a.txt")],
    [file(Buffer.from("Not a PDF"), "a.pdf", "application/pdf")],
    [file(Buffer.from("Rome"), "a.txt", "image/png")],
    [file(Buffer.alloc(L.txtBytes + 1), "large.txt")],
    [file(Buffer.from("Rome"), "a.png", "image/png")],
  ].map(files => [files]))("rejects spoofed, oversized, and unsupported files", async files => await expect(extractAttachments(files)).rejects.toMatchObject({ code: "ATTACHMENT_FAILED" }));
  it("reports failed indices without silently ignoring a good file", async () => await expect(extractAttachments([file(Buffer.from("Rome")), file(Buffer.from("  "), "bad.txt")])).rejects.toMatchObject({ failures: [{ index: 1, code: "ATTACHMENT_EMPTY" }] }));
  it("enforces count, aggregate bytes, and combined text", async () => {
    await expect(extractAttachments(Array.from({ length: 4 }, (_, i) => file(Buffer.from(String(i)))))).rejects.toMatchObject({ code: "ATTACHMENT_COUNT" });
    await expect(extractAttachments([file(Buffer.alloc(L.totalBytes + 1))])).rejects.toMatchObject({ code: "ATTACHMENT_TOTAL_SIZE" });
    await expect(extractAttachments([file(Buffer.from("a".repeat(8000))), file(Buffer.from("b".repeat(8000)), "b.txt"), file(Buffer.from("c".repeat(8000)), "c.txt")])).rejects.toMatchObject({ failures: [{ index: 2, code: "ATTACHMENT_TEXT_LIMIT" }] });
  });
});
