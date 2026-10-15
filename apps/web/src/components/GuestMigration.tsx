import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useIdentityMutation as useMutation } from "../hooks/useIdentityMutation";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import type { GuestMigrationStatus, IdentitySession } from "@triply/shared";
import { getSession } from "../api/auth";
import { ApiError } from "../api/client";
import { confirmGuestMigration, discardGuestMigration, getGuestMigration } from "../api/guestMigration";
import { useToast } from "./ToastProvider";

function importError(error: Error): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return "Your last guest operation is still finishing or the import changed. Check its status and try again.";
    if (error.status === 410) return "This import window has expired or was discarded. Your guest trips have not been deleted.";
    if (error.status === 401 || error.status === 403) return "This import is not authorized in the current sign-in session. Refresh the page to check your session.";
  }
  return "We couldn't finish the import safely. Your trips are preserved. Check the status and try again.";
}
export default function GuestMigration() {
  const client = useQueryClient();
  const toast = useToast();
  const session = useQuery<IdentitySession>({ queryKey: ["auth", "session"], queryFn: getSession, enabled: false });
  const userId = session.data?.status === "authenticated" ? session.data.user.id : null;
  const key = ["guest-migration", userId] as const;
  const status = useQuery({ queryKey: key, queryFn: getGuestMigration, enabled: userId !== null, retry: false,
    refetchInterval: query => query.state.data?.status === "pending" ? query.state.data.busy ? 1500 : 30_000 : false });
  const [deferred, setDeferred] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const refreshPrivateData = async () => {
    const privateQuery = (q: { queryKey: readonly unknown[] }) => ["trips", "guest", "tripSharing", "trip-assistant", "itinerary-candidates"].includes(String(q.queryKey[0]));
    await client.cancelQueries({ predicate: privateQuery });
    client.removeQueries({ predicate: q => privateQuery(q) && !q.isActive() });
    await Promise.all([
      client.resetQueries({ predicate: privateQuery }),
      client.invalidateQueries({ queryKey: ["auth", "session"] }),
    ]);
  };
  const confirm = useMutation({ mutationFn: confirmGuestMigration, onSuccess: async result => {
    client.setQueryData<GuestMigrationStatus>(key, () => ({ status: "completed", importedCount: result.importedCount }));
    await refreshPrivateData();
    toast(result.alreadyImported ? "Your guest trips were already imported." : `Imported ${result.importedCount} guest ${result.importedCount === 1 ? "trip" : "trips"}.`);
  } });
  const discard = useMutation({ mutationFn: discardGuestMigration, onSuccess: result => {
    client.setQueryData(key, result); setDiscardOpen(false);
    toast(result.status === "completed" ? "Your guest trips were already imported." : "Pending import discarded. Your guest trips have not been deleted.");
  } });
  if (!userId) return null;
  if (status.isPending) return <aside className="guest-usage" role="status">Checking for guest trips…</aside>;
  if (status.isError) return <Alert severity="warning">We couldn't check for guest trips. <Button onClick={() => void status.refetch()}>Retry import status</Button></Alert>;
  const data = status.data;
  if (!data || data.status === "none" || data.status === "discarded" || dismissed) return null;
  if (data.status === "expired") return <Alert severity="info">The pending guest import has expired. It can no longer be completed through this sign-in context. Your guest trips have not been deleted.<Button onClick={() => setDismissed(true)}>Dismiss</Button></Alert>;
  if (data.status === "completed") return <Alert severity="success">{data.importedCount} guest {data.importedCount === 1 ? "trip is" : "trips are"} saved to your account.<Button onClick={() => setDismissed(true)}>Dismiss</Button></Alert>;
  const busy = confirm.isPending || discard.isPending;
  const expiry = new Date(data.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const message = `You created ${data.tripCount} ${data.tripCount === 1 ? "trip" : "trips"} while browsing as a guest. Import them to your account so you can keep them.`;
  return <>
    {(deferred || data.busy) && <aside className="guest-usage" aria-label="Pending guest import">
      <span>{data.busy ? "Your last guest operation is still finishing." : `${data.tripCount} guest trips are ready to import.`} This import is available in this sign-in session until {expiry}.</span>
      <Button disabled={busy || data.busy} onClick={() => setDeferred(false)}>Resume import</Button>
      <Button disabled={busy} onClick={() => setDiscardOpen(true)}>Discard pending import</Button>
    </aside>}
    <Dialog open={!deferred && data.tripCount > 0 && !discardOpen} onClose={() => { if (!busy) setDeferred(true); }} fullWidth maxWidth="sm" aria-labelledby="guest-import-title" aria-describedby="guest-import-description">
      <DialogTitle id="guest-import-title">Save your guest trips</DialogTitle>
      <DialogContent><p id="guest-import-description">{message}</p>
        <p>Available until {expiry} in this sign-in session. “Not now” keeps the option available until then. Signing out closes this handoff.</p>
        {data.busy && <p role="status">Your last guest operation is still finishing. Import will be available shortly.</p>}
        {confirm.error && <Alert severity="error">{importError(confirm.error)} <Button onClick={() => void status.refetch()}>Check import status</Button></Alert>}
      </DialogContent>
      <DialogActions><Button disabled={busy} onClick={() => setDeferred(true)}>Not now</Button>
        <Button variant="contained" disabled={busy || data.busy} onClick={() => confirm.mutate()}>{confirm.isPending ? "Importing…" : "Import trips"}</Button>
      </DialogActions>
    </Dialog>
    <Dialog open={discardOpen} onClose={() => { if (!busy) setDiscardOpen(false); }} fullWidth maxWidth="sm" aria-labelledby="guest-discard-title">
      <DialogTitle id="guest-discard-title">Discard this pending import?</DialogTitle>
      <DialogContent>This closes the import option without deleting the guest trips. You will no longer be able to import them through this sign-in context.
        {discard.error && <Alert severity="error">We couldn't discard the import. Please try again.</Alert>}
      </DialogContent>
      <DialogActions><Button disabled={busy} onClick={() => setDiscardOpen(false)}>Cancel</Button><Button color="error" disabled={busy} onClick={() => discard.mutate()}>Discard import</Button></DialogActions>
    </Dialog>
  </>;
}
