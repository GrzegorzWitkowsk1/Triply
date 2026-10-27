import { resolveMessage } from "../../i18n/errors";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { useEffect, useRef, useState } from "react";
import { Alert, Menu, MenuItem } from "@mui/material";
import { ArrowDropDownOutlined, EventOutlined, DownloadOutlined, ShareOutlined } from "@mui/icons-material";
import { useToast } from "../ToastProvider";
import TripPdfDownload from "./TripPdfDownload";
import TripSharing from "./TripSharing";
import type { PdfTarget } from "../../api/pdf";
import { downloadTripCalendar } from "../../api/calendar";
import { ApiError } from "../../api/client";
import { calendarMessages } from "../../config/calendarExport";

export default function TripExportActions({ target, ready = true }: { target: PdfTarget; ready?: boolean }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null), [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sharingOpen, setSharingOpen] = useState(false);
  const active = useRef<AbortController | null>(null);
  const { t } = useTranslation(["sharing/calendar", "sharing", "errors"], { i18n });
  const labels = calendarMessages();
  const toast = useToast();
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  const download = async () => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    setAnchor(null); setPending(true); setError(null);
    try { const result = await downloadTripCalendar(target, controller.signal); if (!controller.signal.aborted) toast(() => labels.result(result.exported, result.excluded)); }
    catch (error) {
      if (!controller.signal.aborted) {
        const code = error instanceof ApiError && error.details && typeof error.details === "object" && "code" in error.details ? String(error.details.code) : "";
        const fallback = error instanceof ApiError ? error.status === 404 ? "not-found" : error.status === 401 ? "unauthorized" : error.status === 429 ? "rate-limited" : "export-failed" : "network-error";
        const key = Object.hasOwn(labels, code) && typeof labels[code as keyof typeof labels] === "string" ? code : fallback;
        setError(`sharing/calendar:${key}`);
      }
    } finally { if (active.current === controller) { active.current = null; setPending(false); } }
  };
  return <div className="trip-export-actions">
    {target.shareToken !== undefined ? <div className="trip-export-buttons">
      <TripPdfDownload target={target} />
      <button type="button" className="trip-action" disabled={pending} onClick={() => void download()}><EventOutlined />{pending ? labels.preparing : labels.calendar}</button>
    </div> : <>
      <button type="button" className="trip-action trip-export-menu" aria-label={labels.options} aria-haspopup="menu" aria-expanded={Boolean(anchor)}
        disabled={pending} onClick={event => setAnchor(event.currentTarget)}><ArrowDropDownOutlined /></button>
    <Menu keepMounted anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
      <TripPdfDownload target={target} renderTrigger={(downloadPdf, pdfPending) => <MenuItem disabled={!ready || pdfPending} onClick={downloadPdf}><DownloadOutlined sx={{ mr: 1 }} />{t(pdfPending ? "preparingPdf" : "downloadPdf", { ns: "sharing" })}</MenuItem>} />
      <MenuItem disabled={!ready || pending} onClick={() => void download()}><EventOutlined sx={{ mr: 1 }} />{labels.calendar}</MenuItem>
      <MenuItem onClick={() => { setAnchor(null); setSharingOpen(true); }}><ShareOutlined sx={{ mr: 1 }} />{t("share", { ns: "sharing" })}</MenuItem>
    </Menu>
    <TripSharing tripId={target.tripId!} hideTrigger open={sharingOpen} onClose={() => setSharingOpen(false)} />
    </>}
    {pending && <p role="status">{labels.preparing}</p>}
    {error && <Alert severity="error">{resolveMessage(error)}</Alert>}
  </div>;
}
