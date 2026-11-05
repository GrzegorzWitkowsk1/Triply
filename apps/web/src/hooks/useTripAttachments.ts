import { useRef, useState } from "react";
import { ATTACHMENT_LIMITS as L, validateAttachmentFile, type AttachmentErrorCode, type AttachmentFailure } from "@triply/shared";

export interface SelectedAttachment { id: number; file: File; error: AttachmentErrorCode | null; }
export function useTripAttachments() {
  const nextId = useRef(0);
  const [entries, setEntries] = useState<SelectedAttachment[]>([]);
  const [notice, setNotice] = useState<AttachmentErrorCode | null>(null);
  const pick = (list: FileList | File[] | null) => {
    if (!list) return;
    setEntries(previous => {
      const next = [...previous];
      let total = next.reduce((sum, entry) => sum + entry.file.size, 0);
      for (const file of Array.from(list)) {
        if (next.some(entry => entry.file.name === file.name && entry.file.size === file.size && entry.file.lastModified === file.lastModified)) { setNotice("ATTACHMENT_DUPLICATE"); continue; }
        if (next.length >= L.files + 1) { setNotice("ATTACHMENT_COUNT"); break; }
        total += file.size;
        const error = validateAttachmentFile(file) ?? (next.length >= L.files ? "ATTACHMENT_COUNT" : total > L.totalBytes ? "ATTACHMENT_TOTAL_SIZE" : null);
        next.push({ id: nextId.current++, file, error });
      }
      return next;
    });
  };
  const remove = (id: number) => { setEntries(previous => previous.filter(entry => entry.id !== id)); setNotice(null); };
  const fail = (failures: AttachmentFailure[]) => setEntries(previous => previous.map((entry, index) => ({ ...entry, error: failures.find(failure => failure.index === index)?.code ?? entry.error })));
  const clear = () => { setEntries([]); setNotice(null); };
  return { entries, pick, remove, fail, clear, notice, blocked: entries.some(entry => entry.error !== null), files: entries.map(entry => entry.file) };
}
