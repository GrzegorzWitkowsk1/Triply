import { getSelectedLanguage } from "../i18n";
import { calendarExportStatsSchema, type CalendarExportStats } from "@triply/shared";
import type { PdfTarget } from "./pdf";
import { ApiError, parseResponse } from "./client";

export async function downloadTripCalendar(target: PdfTarget, signal?: AbortSignal): Promise<CalendarExportStats> {
  const isPublic = target.shareToken !== undefined;
  const path = isPublic ? `/api/public/trips/${encodeURIComponent(target.shareToken!)}/export/calendar`
    : `/api/trips/${encodeURIComponent(target.tripId!)}/export/calendar`;
  const response = await fetch(`${path}?locale=${getSelectedLanguage()}`,  { credentials: isPublic ? "omit" : "include", cache: "no-store", referrerPolicy: "no-referrer", headers: { Accept: "text/calendar" }, signal });
  if (!response.ok) { await parseResponse(response); throw new Error("Calendar request failed"); }
  const invalid = () => new ApiError("Invalid calendar response", 502, { code: "invalid-response" });
  if (!response.headers.get("Content-Type")?.startsWith("text/calendar")) throw invalid();
  const number = (name: string) => { const value = response.headers.get(name); return value && /^\d+$/.test(value) ? Number(value) : NaN; };
  const parsed = calendarExportStatsSchema.safeParse({ exported: number("X-Triply-Calendar-Events"), excluded: number("X-Triply-Calendar-Excluded"), unscheduled: number("X-Triply-Calendar-Unscheduled"), invalid: number("X-Triply-Calendar-Invalid") });
  if (!parsed.success || !parsed.data.exported) throw invalid();
  const blob = await response.blob();
  if (!blob.size || blob.size > 2 * 1024 * 1024) throw invalid();
  const filename = /filename="(triply-[a-z0-9-]+\.ics)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "triply-itinerary.ics";
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename;
    document.body.appendChild(anchor); try { anchor.click(); } finally { anchor.remove(); }
  } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
  return parsed.data;
}
