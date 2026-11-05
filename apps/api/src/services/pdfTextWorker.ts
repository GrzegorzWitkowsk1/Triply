import { parentPort, workerData } from "node:worker_threads";
import { ATTACHMENT_LIMITS, type AttachmentErrorCode } from "@triply/shared";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// Only bytes are accepted. No document URLs, rendering, actions, attachments or remote assets.
globalThis.fetch = async () => { throw new Error("Network disabled in PDF extraction"); };
const port = parentPort!;
let failure: AttachmentErrorCode = "ATTACHMENT_INVALID_PDF";
const task = getDocument({ data: new Uint8Array(workerData as ArrayBuffer), verbosity: 0,
  useWorkerFetch: false, useSystemFonts: false, disableFontFace: true, useWasm: false,
  isOffscreenCanvasSupported: false, isImageDecoderSupported: false, enableXfa: false, stopAtErrors: true });
task.onPassword = () => { failure = "ATTACHMENT_ENCRYPTED_PDF"; void task.destroy(); };
try {
  const pdf = await task.promise;
  if (await pdf.getPermissions() !== null) { failure = "ATTACHMENT_ENCRYPTED_PDF"; throw new Error(); }
  if (pdf.numPages > ATTACHMENT_LIMITS.pages) { failure = "ATTACHMENT_PAGES"; throw new Error(); }
  const pages: string[] = [];
  let length = 0;
  for (let index = 1; index <= pdf.numPages; index++) {
    const page = await pdf.getPage(index);
    const reader = page.streamTextContent().getReader();
    let text = "";
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        for (const item of chunk.value.items) {
          if (!("str" in item)) continue;
          const value = item.str + (item.hasEOL ? "\n" : "");
          length += value.length;
          if (length > ATTACHMENT_LIMITS.textCharacters) { failure = "ATTACHMENT_TEXT_LIMIT"; throw new Error(); }
          text += value;
        }
      }
    } finally { await reader.cancel().catch(() => {}); page.cleanup(); }
    pages.push(text.trim());
  }
  const text = pages.join("\n\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "").trim();
  if (text.length > ATTACHMENT_LIMITS.textCharacters) { failure = "ATTACHMENT_TEXT_LIMIT"; throw new Error(); }
  if (!text) { failure = "ATTACHMENT_SCANNED_PDF"; throw new Error(); }
  port.postMessage({ text });
} catch { port.postMessage({ code: failure }); }
finally { await task.destroy().catch(() => {}); port.close(); }
