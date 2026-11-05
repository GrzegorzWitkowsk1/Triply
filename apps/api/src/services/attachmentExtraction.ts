import { Worker } from "node:worker_threads";
import { createHash } from "node:crypto";
import { ATTACHMENT_LIMITS as L, validateAttachmentFile, type AttachmentErrorCode, type AttachmentFailure } from "@triply/shared";

export class AttachmentError extends Error {
  readonly expose = true;
  constructor(readonly code: AttachmentErrorCode, readonly status = 400, readonly failures: AttachmentFailure[] = []) {
    super("Attachment processing failed");
  }
}
export interface AttachmentBytes { name: string; type: string; bytes: Buffer; }

// No waiting requests retain uploaded buffers: a full pool fails immediately (bounded queue = 0).
let activeWorkers = 0;
export function extractPdf(bytes: Buffer, signal?: AbortSignal, timeoutMs: number = L.pdfTimeoutMs): Promise<string> {
  if (activeWorkers >= 2) return Promise.reject(new AttachmentError("ATTACHMENT_BUSY", 429));
  if (signal?.aborted) return Promise.reject(new AttachmentError("ATTACHMENT_TIMEOUT", 408));
  activeWorkers++;
  return new Promise((resolve, reject) => {
    let worker: Worker;
    const data = Uint8Array.from(bytes).buffer;
    try {
      worker = new Worker(new URL(`./pdfTextWorker.${import.meta.url.endsWith(".ts") ? "ts" : "js"}`, import.meta.url), {
        workerData: data, transferList: [data], execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 },
      });
    } catch { activeWorkers--; reject(new AttachmentError("ATTACHMENT_FAILED")); return; }
    let finished = false;
    const finish = async (error?: AttachmentError, text?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      await worker.terminate().catch(() => {});
      activeWorkers--;
      if (error) reject(error); else resolve(text!);
    };
    const abort = () => { void finish(new AttachmentError("ATTACHMENT_TIMEOUT", 408)); };
    const timer = setTimeout(abort, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    worker.once("message", (message: { text?: string; code?: AttachmentErrorCode }) => {
      if (typeof message.text === "string" && message.text.length <= L.textCharacters) void finish(undefined, message.text);
      else void finish(new AttachmentError(message.code ?? "ATTACHMENT_INVALID_PDF"));
    });
    worker.once("error", () => { void finish(new AttachmentError("ATTACHMENT_INVALID_PDF")); });
    worker.once("exit", () => { if (!finished) void finish(new AttachmentError("ATTACHMENT_INVALID_PDF")); });
    if (signal?.aborted) abort();
  });
}

export function extractTxt(bytes: Buffer): string {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new AttachmentError("ATTACHMENT_ENCODING"); }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) throw new AttachmentError("ATTACHMENT_ENCODING");
  text = text.replace(/^\uFEFF/u, "").replace(/\r\n?/g, "\n").trim();
  if (!text) throw new AttachmentError("ATTACHMENT_EMPTY");
  if (text.length > L.textCharacters) throw new AttachmentError("ATTACHMENT_TEXT_LIMIT");
  return text;
}

export async function extractAttachments(files: AttachmentBytes[], signal?: AbortSignal): Promise<string[]> {
  if (!files.length || files.length > L.files) throw new AttachmentError("ATTACHMENT_COUNT");
  if (files.reduce((sum, file) => sum + file.bytes.length, 0) > L.totalBytes) throw new AttachmentError("ATTACHMENT_TOTAL_SIZE", 413);
  const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(L.extractionTimeoutMs)]);
  const failures: AttachmentFailure[] = [], texts: string[] = [], hashes = new Set<string>();
  let total = 0;
  for (const [index, file] of files.entries()) {
    try {
      if (deadline.aborted) throw new AttachmentError("ATTACHMENT_TIMEOUT", 408);
      const invalid = validateAttachmentFile({ ...file, size: file.bytes.length });
      if (invalid) throw new AttachmentError(invalid);
      const hash = createHash("sha256").update(file.bytes).digest("hex");
      if (hashes.has(hash)) throw new AttachmentError("ATTACHMENT_DUPLICATE");
      hashes.add(hash);
      const pdf = file.name.toLowerCase().endsWith(".pdf");
      if (pdf && file.bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new AttachmentError("ATTACHMENT_INVALID_PDF");
      if (!pdf && file.bytes.subarray(0, 5).toString("ascii") === "%PDF-") throw new AttachmentError("ATTACHMENT_FORMAT");
      const text = pdf ? await extractPdf(file.bytes, deadline) : extractTxt(file.bytes);
      total += text.length;
      if (total > L.totalTextCharacters) throw new AttachmentError("ATTACHMENT_TEXT_LIMIT");
      texts.push(text);
    } catch (error) {
      failures.push({ index, code: error instanceof AttachmentError ? error.code : "ATTACHMENT_FAILED" });
    }
  }
  if (failures.length) throw new AttachmentError("ATTACHMENT_FAILED", 422, failures);
  return texts;
}
