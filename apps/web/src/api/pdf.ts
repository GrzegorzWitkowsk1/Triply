import { getSelectedLanguage } from "../i18n";
import { ApiError, parseResponse } from "./client";

export type PdfTarget = { tripId: string; shareToken?: never } | { shareToken: string; tripId?: never };
export async function downloadTripPdf(target: PdfTarget, signal?: AbortSignal): Promise<void> {
  const isPublic = target.shareToken !== undefined;
  const path = isPublic ? `/api/public/trips/${encodeURIComponent(target.shareToken!)}/export/pdf`
    : `/api/trips/${encodeURIComponent(target.tripId!)}/export/pdf`;
  const response = await fetch(`${path}?locale=${getSelectedLanguage()}`,  { credentials: isPublic ? "omit" : "include", cache: "no-store",
    referrerPolicy: "no-referrer", headers: { Accept: "application/pdf" }, signal });
  if (!response.ok) { await parseResponse(response); return; }
  if (!response.headers.get("Content-Type")?.startsWith("application/pdf")) throw new ApiError("The server did not return a PDF. Please try again.", 502);
  const blob = await response.blob();
  if (blob.size === 0 || blob.size > 8 * 1024 * 1024) throw new ApiError("The PDF download could not be completed.", 502);
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filename = /filename="(triply-[a-z0-9-]+\.pdf)"/.exec(disposition)?.[1] ?? "triply-itinerary.pdf";
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename;
    document.body.appendChild(anchor);
    try { anchor.click(); } finally { anchor.remove(); }
  } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
}
