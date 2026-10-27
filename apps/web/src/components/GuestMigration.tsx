import { formatTime } from "../i18n/format";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useIdentityMutation as useMutation } from "../hooks/useIdentityMutation";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import type { GuestMigrationStatus, IdentitySession } from "@triply/shared";
import { getSession } from "../api/auth";
import { ApiError } from "../api/client";
import { confirmGuestMigration, discardGuestMigration, getGuestMigration } from "../api/guestMigration";
import { useToast } from "./ToastProvider";
import { guestDataSummary } from "../config/guestMigration";

function importError(error: Error): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return i18n.t("yourLastGuestOperationIsStillFinishingOr", { ns: "auth/migration" });
    if (error.status === 410) return i18n.t("thisImportWindowHasExpiredOrWasDiscarded", { ns: "auth/migration" });
    if (error.status === 401 || error.status === 403) return i18n.t("thisImportIsNotAuthorizedInTheCurrent", { ns: "auth/migration" });
  }
  return i18n.t("weCouldnTFinishTheImportSafelyYour", { ns: "auth/migration" });
}
export default function GuestMigration() {
  useTranslation();
  const client = useQueryClient();
  const toast = useToast();
  const session = useQuery<IdentitySession>({ queryKey: ["auth", "session"], queryFn: getSession, enabled: false });
  const userId = session.data?.status === "authenticated" ? session.data.user.id : null;
  const key = ["guest-migration", userId] as const;
  const status = useQuery({ queryKey: key, queryFn: getGuestMigration, enabled: userId !== null, retry: false,
    refetchInterval: query => query.state.data?.status === "pending" ? query.state.data.busy ? 1500 : 30_000 : false });
  const boundQuery = client.getQueryCache().find({ queryKey: key, exact: true });
  const [deferred, setDeferred] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const refreshedReceipt = useRef(false);
  const stillCurrent = () => {
    const current = client.getQueryData<IdentitySession>(["auth", "session"]);
    return current?.status === "authenticated" && current.user.id === userId && client.getQueryCache().find({ queryKey: key, exact: true }) === boundQuery;
  };
  const refreshPrivateData = async () => {
    const privateQuery = (q: { queryKey: readonly unknown[] }) => ["trips", "saved", "guest", "tripSharing", "trip-assistant", "itinerary-candidates"].includes(String(q.queryKey[0]));
    await client.cancelQueries({ predicate: privateQuery });
    if (!stillCurrent()) return;
    client.removeQueries({ predicate: q => privateQuery(q) && !q.isActive() });
    await Promise.all([
      client.resetQueries({ predicate: privateQuery }),
      client.invalidateQueries({ queryKey: ["auth", "session"] }),
    ]);
  };
  const confirm = useMutation({ mutationFn: confirmGuestMigration, onMutate: () => boundQuery, onSuccess: async (result, _variables, startedQuery) => {
    if (!startedQuery || startedQuery !== boundQuery || !stillCurrent()) return;
    refreshedReceipt.current = true;
    const { alreadyImported, ...counts } = result;
    client.setQueryData<GuestMigrationStatus>(key, () => ({ status: "completed", ...counts }));
    await refreshPrivateData();
    if (stillCurrent()) toast(() => alreadyImported ? i18n.t("yourGuestDataWasAlreadyImported", { ns: "auth/migration" }) : i18n.t("imported", { ns: "auth/migration", value0: guestDataSummary(result.importedCount, result.importedDestinationCount ?? 0, result.importedAttractionCount ?? 0) }));
  } });
  const discard = useMutation({ mutationFn: discardGuestMigration, onMutate: () => boundQuery, onSuccess: (result, _variables, startedQuery) => {
    if (!startedQuery || startedQuery !== boundQuery || !stillCurrent()) return;
    client.setQueryData(key, result); setDiscardOpen(false);
    toast(() => result.status === "completed" ? i18n.t("yourGuestDataWasAlreadyImported", { ns: "auth/migration" }) : i18n.t("pendingImportDiscardedYourGuestDataHasNot", { ns: "auth/migration" }));
  } });
  useEffect(() => {
    // A lost confirmation response can be recovered through status without confirming again.
    if (status.data?.status === "completed" && !refreshedReceipt.current) {
      refreshedReceipt.current = true;
      void refreshPrivateData();
    }
  }, [status.data, userId]);
  if (!userId) return null;
  if (status.isPending) return <aside className="guest-usage" role="status">{i18n.t("checkingForGuestData", { ns: "auth/migration" })}</aside>;
  if (status.isError) return <Alert severity="warning">{i18n.t("weCouldnTCheckForGuestData", { ns: "auth/migration" })}<Button onClick={() => void status.refetch()}>{i18n.t("retryImportStatus", { ns: "auth/migration" })}</Button></Alert>;
  const data = status.data;
  if (!data || data.status === "none" || data.status === "discarded" || dismissed) return null;
  if (data.status === "expired") return <Alert severity="info">{i18n.t("thePendingGuestImportHasExpiredItCan", { ns: "auth/migration" })}<Button onClick={() => setDismissed(true)}>{i18n.t("dismiss", { ns: "common" })}</Button></Alert>;
  if (data.status === "completed") {
    const total = data.importedCount + (data.importedDestinationCount ?? 0) + (data.importedAttractionCount ?? 0);
    const merged = (data.mergedDestinationCount ?? 0) + (data.mergedAttractionCount ?? 0);
    return <Alert severity="success">{i18n.t("savedReceipt", { ns: "auth/migration", count: total, summary: guestDataSummary(data.importedCount, data.importedDestinationCount ?? 0, data.importedAttractionCount ?? 0) })}
      {merged > 0 && i18n.t("mergedReceipt", { ns: "auth/migration", count: merged, summary: guestDataSummary(0, data.mergedDestinationCount, data.mergedAttractionCount) })}<Button onClick={() => setDismissed(true)}>{i18n.t("dismiss", { ns: "common" })}</Button></Alert>;
  }
  const busy = confirm.isPending || discard.isPending;
  const expiry = formatTime(data.expiresAt);
  const summary = guestDataSummary(data.tripCount, data.destinationCount ?? 0, data.attractionCount ?? 0);
  const total = data.tripCount + (data.destinationCount ?? 0) + (data.attractionCount ?? 0);
  const message = i18n.t("youHaveSavedAsAGuestImportThem", { ns: "auth/migration", value0: summary });
  return <>
    {(deferred || data.busy) && <aside className="guest-usage" aria-label={i18n.t("pendingGuestImport", { ns: "auth/migration" })}>
      <span>{data.busy ? i18n.t("yourLastGuestOperationIsStillFinishing", { ns: "auth/migration" }) : i18n.t("fromYourGuestSessionReadyToImport", { ns: "auth/migration", value0: summary })} {i18n.t("handoffExpiry", { ns: "auth/migration", expiry })}</span>
      <Button disabled={busy || data.busy} onClick={() => setDeferred(false)}>{i18n.t("resumeImport", { ns: "auth/migration" })}</Button>
      <Button disabled={busy} onClick={() => setDiscardOpen(true)}>{i18n.t("discardPendingImport", { ns: "auth/migration" })}</Button>
    </aside>}
    <Dialog open={!deferred && total > 0 && !discardOpen} onClose={() => { if (!busy) setDeferred(true); }} fullWidth maxWidth="sm" aria-labelledby="guest-import-title" aria-describedby="guest-import-description">
      <DialogTitle id="guest-import-title">{i18n.t("saveYourGuestData", { ns: "auth/migration" })}</DialogTitle>
      <DialogContent><p id="guest-import-description">{message}</p>
        <p>{i18n.t("handoffExplanation", { ns: "auth/migration", expiry })}</p>
        {data.busy && <p role="status">{i18n.t("yourLastGuestOperationIsStillFinishingImport", { ns: "auth/migration" })}</p>}
        {confirm.error && <Alert severity="error">{importError(confirm.error)} <Button onClick={() => void status.refetch()}>{i18n.t("checkImportStatus", { ns: "auth/migration" })}</Button></Alert>}
      </DialogContent>
      <DialogActions><Button disabled={busy} onClick={() => setDeferred(true)}>{i18n.t("notNow", { ns: "auth/migration" })}</Button>
        <Button variant="contained" disabled={busy || data.busy} onClick={() => confirm.mutate()}>{confirm.isPending ? i18n.t("importing", { ns: "auth/migration" }) : i18n.t("importToMyAccount", { ns: "auth/migration" })}</Button>
      </DialogActions>
    </Dialog>
    <Dialog open={discardOpen} onClose={() => { if (!busy) setDiscardOpen(false); }} fullWidth maxWidth="sm" aria-labelledby="guest-discard-title">
      <DialogTitle id="guest-discard-title">{i18n.t("discardThisPendingImport", { ns: "auth/migration" })}</DialogTitle>
      <DialogContent>{i18n.t("thisClosesTheImportOptionWithoutDeletingThe", { ns: "auth/migration" })}{discard.error && <Alert severity="error">{i18n.t("weCouldnTDiscardTheImportPleaseTry", { ns: "auth/migration" })}</Alert>}
      </DialogContent>
      <DialogActions><Button disabled={busy} onClick={() => setDiscardOpen(false)}>{i18n.t("cancel", { ns: "common" })}</Button><Button color="error" disabled={busy} onClick={() => discard.mutate()}>{i18n.t("discardImport", { ns: "auth/migration" })}</Button></DialogActions>
    </Dialog>
  </>;
}
