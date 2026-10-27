import { errorKey as localizedErrorKey, resolveMessage } from "../../i18n/errors";
import { errorMessage as localizedError } from "../../i18n/errors";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert } from "@mui/material";
import { DownloadOutlined } from "@mui/icons-material";
import { downloadTripPdf, type PdfTarget } from "../../api/pdf";

export default function TripPdfDownload({ target, renderTrigger }: { target: PdfTarget; renderTrigger?: (download: () => void, pending: boolean) => ReactNode }) {
  const { t } = useTranslation("sharing", { i18n });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  const download = async () => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    setPending(true); setError(null);
    try { await downloadTripPdf(target, controller.signal); }
    catch (error) { if (!controller.signal.aborted) setError(localizedErrorKey(error)); }
    finally { if (active.current === controller) { active.current = null; setPending(false); } }
  };
  return <div>
    {renderTrigger ? renderTrigger(() => void download(), pending) : <button className="trip-action" type="button" disabled={pending} onClick={() => void download()}>
      <DownloadOutlined /> {t(pending ? "preparingPdf" : "downloadPdf")}
    </button>}
    {error && <Alert severity="error">{resolveMessage(error)}</Alert>}
  </div>;
}
