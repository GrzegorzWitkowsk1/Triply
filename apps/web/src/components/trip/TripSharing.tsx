import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from "@mui/material";
import { ShareOutlined } from "@mui/icons-material";
import { createShareLink, disableSharing, getSharingStatus } from "../../api/sharing";

export default function TripSharing({ tripId, open: controlledOpen, onClose, hideTrigger = false }: { tripId: string; open?: boolean; onClose?: () => void; hideTrigger?: boolean }) {
  const [internalOpen, setOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [link, setLink] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"rotate" | "disable" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copyError, setCopyError] = useState(false);
  const client = useQueryClient();
  const key = ["tripSharing", tripId];
  const status = useQuery({ queryKey: key, queryFn: () => getSharingStatus(tripId), enabled: open, staleTime: 0 });
  const action = useMutation({ gcTime: 0, mutationFn: async (operation: "enable" | "rotate" | "disable") => operation === "disable"
    ? disableSharing(tripId) : createShareLink(tripId, operation === "rotate"),
    onSuccess: (result) => {
      setLink("token" in result ? `${window.location.origin}/shared/${result.token}` : null);
      client.setQueryData(key, { enabled: result.enabled, createdAt: result.createdAt, updatedAt: result.updatedAt });
      setConfirm(null); setNotice(null); setCopyError(false);
    }, onError: () => { setLink(null); void client.invalidateQueries({ queryKey: key }); },
  });
  const close = () => { if (!action.isPending) { setOpen(false); setLink(null); setConfirm(null); setNotice(null); setCopyError(false); action.reset(); onClose?.(); } };
  return (
    <>
      {!hideTrigger && <button
        className="trip-action"
        type="button"
        onClick={() => setOpen(true)}
      >
        <ShareOutlined /> Share
      </button>}
      <Dialog className="trip-sharing-dialog" open={open} onClose={close} fullWidth maxWidth="sm">
        <DialogTitle>Share itinerary</DialogTitle>
        <DialogContent>
          <p>
            Anyone with the link can view your itinerary and dates. Budget,
            expenses and private notes stay private.
          </p>
          {status.isPending && <p role="status">Loading sharing status…</p>}
          {status.isError && (
            <Alert severity="error">
              Could not load sharing status.{" "}
              <Button onClick={() => void status.refetch()}>Retry</Button>
            </Alert>
          )}
          {status.data && (
            <p>Sharing {status.data.enabled ? "enabled" : "disabled"}</p>
          )}
          {status.data?.enabled && (
            <p>
              The link is shown only when created. Copy it now; after closing
              this dialog, rotate the link to get a new one.
            </p>
          )}
          {link && status.data?.enabled && (
            <TextField
              style={{ marginTop: "12px" }}
              fullWidth
              label="Share link"
              value={link}
              slotProps={{ input: { readOnly: true } }}
            />
          )}
          {notice && <p role="status">{notice}</p>}
          {copyError && (
            <Alert severity="error">
              Could not copy. Select and copy the link above.
            </Alert>
          )}
          {action.isError && (
            <Alert severity="error">{action.error.message}</Alert>
          )}
          {confirm && (
            <Alert severity="warning">
              {confirm === "rotate"
                ? "Rotating invalidates the previous link."
                : "Disabling immediately revokes the link."}
              <Button
                disabled={action.isPending}
                onClick={() => action.mutate(confirm)}
              >
                Confirm {confirm}
              </Button>
              <Button
                disabled={action.isPending}
                onClick={() => setConfirm(null)}
              >
                Cancel
              </Button>
            </Alert>
          )}
          {action.isPending && <p role="status">Updating sharing…</p>}
        </DialogContent>
        <DialogActions>
          {status.data && !status.isError && !status.isFetching && !confirm && (
            <>
              {!status.data.enabled && (
                <Button
                  disabled={action.isPending}
                  onClick={() => action.mutate("enable")}
                >
                  Enable sharing
                </Button>
              )}
              {status.data.enabled && (
                <>
                  {link && (
                    <Button
                      disabled={action.isPending}
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(link);
                          setNotice("Link copied");
                          setCopyError(false);
                        } catch {
                          setCopyError(true);
                        }
                      }}
                    >
                      Copy link
                    </Button>
                  )}
                  <Button
                    disabled={action.isPending}
                    onClick={() => setConfirm("rotate")}
                  >
                    Rotate link
                  </Button>
                  <Button
                    disabled={action.isPending}
                    onClick={() => setConfirm("disable")}
                  >
                    Disable sharing
                  </Button>
                </>
              )}
            </>
          )}
          <Button disabled={action.isPending} onClick={close}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
