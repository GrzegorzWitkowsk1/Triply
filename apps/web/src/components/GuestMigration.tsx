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
    if (error.status === 409) return "Your last guest operation is still finishing or the import changed. Check its status and try again.";
    if (error.status === 410) return "This import window has expired or was discarded. Your guest data has not been deleted.";
    if (error.status === 401 || error.status === 403) return "This import is not authorized in the current sign-in session. Refresh the page to check your session.";
  }
  return "We couldn't finish the import safely. Your guest data is preserved. Check the status and try again.";
}
export default function GuestMigration() {
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
    if (stillCurrent()) toast(alreadyImported ? "Your guest data was already imported." : `Imported ${guestDataSummary(result.importedCount, result.importedDestinationCount ?? 0, result.importedAttractionCount ?? 0)}.`);
  } });
  const discard = useMutation({ mutationFn: discardGuestMigration, onMutate: () => boundQuery, onSuccess: (result, _variables, startedQuery) => {
    if (!startedQuery || startedQuery !== boundQuery || !stillCurrent()) return;
    client.setQueryData(key, result); setDiscardOpen(false);
    toast(result.status === "completed" ? "Your guest data was already imported." : "Pending import discarded. Your guest data has not been deleted.");
  } });
  useEffect(() => {
    // A lost confirmation response can be recovered through status without confirming again.
    if (status.data?.status === "completed" && !refreshedReceipt.current) {
      refreshedReceipt.current = true;
      void refreshPrivateData();
    }
  }, [status.data, userId]);
  if (!userId) return null;
  if (status.isPending) return <aside className="guest-usage" role="status">Checking for guest data…</aside>;
  if (status.isError) return <Alert severity="warning">We couldn't check for guest data. <Button onClick={() => void status.refetch()}>Retry import status</Button></Alert>;
  const data = status.data;
  if (!data || data.status === "none" || data.status === "discarded" || dismissed) return null;
  if (data.status === "expired") return <Alert severity="info">The pending guest import has expired. It can no longer be completed through this sign-in context. Your guest data has not been deleted.<Button onClick={() => setDismissed(true)}>Dismiss</Button></Alert>;
  if (data.status === "completed") {
    const total = data.importedCount + (data.importedDestinationCount ?? 0) + (data.importedAttractionCount ?? 0);
    const merged = (data.mergedDestinationCount ?? 0) + (data.mergedAttractionCount ?? 0);
    return <Alert severity="success">{guestDataSummary(data.importedCount, data.importedDestinationCount ?? 0, data.importedAttractionCount ?? 0)} from your guest session {total === 1 ? "is" : "are"} saved to your account.
      {merged > 0 && ` ${guestDataSummary(0, data.mergedDestinationCount, data.mergedAttractionCount)} ${merged === 1 ? "was" : "were"} already saved and merged.`}<Button onClick={() => setDismissed(true)}>Dismiss</Button></Alert>;
  }
  const busy = confirm.isPending || discard.isPending;
  const expiry = new Date(data.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const summary = guestDataSummary(data.tripCount, data.destinationCount ?? 0, data.attractionCount ?? 0);
  const total = data.tripCount + (data.destinationCount ?? 0) + (data.attractionCount ?? 0);
  const message = `You have ${summary} saved as a guest. Import them to your account?`;
  return <>
    {(deferred || data.busy) && <aside className="guest-usage" aria-label="Pending guest import">
      <span>{data.busy ? "Your last guest operation is still finishing." : `${summary} from your guest session ready to import.`} This import is available in this sign-in session until {expiry}.</span>
      <Button disabled={busy || data.busy} onClick={() => setDeferred(false)}>Resume import</Button>
      <Button disabled={busy} onClick={() => setDiscardOpen(true)}>Discard pending import</Button>
    </aside>}
    <Dialog open={!deferred && total > 0 && !discardOpen} onClose={() => { if (!busy) setDeferred(true); }} fullWidth maxWidth="sm" aria-labelledby="guest-import-title" aria-describedby="guest-import-description">
      <DialogTitle id="guest-import-title">Save your guest data</DialogTitle>
      <DialogContent><p id="guest-import-description">{message}</p>
        <p>Available until {expiry} in this sign-in session. “Not now” keeps the option available until then. Signing out closes this handoff.</p>
        {data.busy && <p role="status">Your last guest operation is still finishing. Import will be available shortly.</p>}
        {confirm.error && <Alert severity="error">{importError(confirm.error)} <Button onClick={() => void status.refetch()}>Check import status</Button></Alert>}
      </DialogContent>
      <DialogActions><Button disabled={busy} onClick={() => setDeferred(true)}>Not now</Button>
        <Button variant="contained" disabled={busy || data.busy} onClick={() => confirm.mutate()}>{confirm.isPending ? "Importing…" : "Import to my account"}</Button>
      </DialogActions>
    </Dialog>
    <Dialog open={discardOpen} onClose={() => { if (!busy) setDiscardOpen(false); }} fullWidth maxWidth="sm" aria-labelledby="guest-discard-title">
      <DialogTitle id="guest-discard-title">Discard this pending import?</DialogTitle>
      <DialogContent>This closes the import option without deleting the guest data. You will no longer be able to import it through this sign-in context.
        {discard.error && <Alert severity="error">We couldn't discard the import. Please try again.</Alert>}
      </DialogContent>
      <DialogActions><Button disabled={busy} onClick={() => setDiscardOpen(false)}>Cancel</Button><Button color="error" disabled={busy} onClick={() => discard.mutate()}>Discard import</Button></DialogActions>
    </Dialog>
  </>;
}
