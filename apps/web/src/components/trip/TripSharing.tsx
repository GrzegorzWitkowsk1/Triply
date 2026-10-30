import { resolveMessage } from "../../i18n/errors";
import { errorMessage as localizedError } from "../../i18n/errors";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useIdentityMutation as useMutation } from "../../hooks/useIdentityMutation";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from "@mui/material";
import { ShareOutlined } from "@mui/icons-material";
import { createShareLink, disableSharing, getSharingStatus } from "../../api/sharing";

export default function TripSharing({ tripId, open: controlledOpen, onClose, hideTrigger = false }: { tripId: string; open?: boolean; onClose?: () => void; hideTrigger?: boolean }) {
  const { t } = useTranslation("sharing", { i18n });
  const [internalOpen, setOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [link, setLink] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"rotate" | "disable" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copyError, setCopyError] = useState(false);
  const client = useQueryClient();
  const actionLock = useRef(false);
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
  const run = (operation: "enable" | "rotate" | "disable") => {
    if (actionLock.current || action.isPending) return;
    actionLock.current = true;
    action.mutate(operation, { onSettled: () => { actionLock.current = false; } });
  };
  const close = () => { if (!action.isPending) { setOpen(false); setLink(null); setConfirm(null); setNotice(null); setCopyError(false); action.reset(); onClose?.(); } };
  return (
    <>
      {!hideTrigger && <button
        className="trip-action"
        type="button"
        onClick={() => setOpen(true)}
      >
        <ShareOutlined /> {t("share")}
      </button>}
      <Dialog className="trip-sharing-dialog" open={open} onClose={close} fullWidth maxWidth="sm">
        <DialogTitle>{t("itineraryTitle")}</DialogTitle>
        <DialogContent>
          <p>
            {i18n.t("anyoneWithTheLinkCanViewYourItinerary", { ns: "sharing" })}</p>
          {status.isPending && <p role="status">{i18n.t("loadingSharingStatus", { ns: "sharing" })}</p>}
          {status.isError && (
            <Alert severity="error">
              {i18n.t("couldNotLoadSharingStatus", { ns: "sharing" })}{" "}
              <Button onClick={() => void status.refetch()}>{t("retry", { ns: "common" })}</Button>
            </Alert>
          )}
          {status.data && (
            <p>{i18n.t(status.data.enabled ? "sharingEnabled" : "sharingDisabled", { ns: "sharing" })}</p>
          )}
          {status.data?.enabled && (
            <p>
              {i18n.t("theLinkIsShownOnlyWhenCreatedCopy", { ns: "sharing" })}</p>
          )}
          {link && status.data?.enabled && (
            <TextField
              style={{ marginTop: "12px" }}
              fullWidth
              label={i18n.t("shareLink", { ns: "sharing" })}
              value={link}
              slotProps={{ input: { readOnly: true } }}
            />
          )}
          {notice && <p role="status">{resolveMessage(notice)}</p>}
          {copyError && (
            <Alert severity="error">
              {i18n.t("couldNotCopySelectAndCopyTheLink", { ns: "sharing" })}</Alert>
          )}
          {action.isError && (
            <Alert severity="error">{localizedError(action.error)}</Alert>
          )}
          {confirm && (
            <Alert severity="warning">
              {confirm === "rotate"
                ? i18n.t("rotatingInvalidatesThePreviousLink", { ns: "sharing" })
                : i18n.t("disablingImmediatelyRevokesTheLink", { ns: "sharing" })}
              <Button
                disabled={action.isPending}
                onClick={() => run(confirm)}
              >
                {i18n.t(confirm === "rotate" ? "confirmRotate" : "confirmDisable", { ns: "sharing" })}
              </Button>
              <Button
                disabled={action.isPending}
                onClick={() => setConfirm(null)}
              >
                {t("cancel", { ns: "common" })}
              </Button>
            </Alert>
          )}
          {action.isPending && <p role="status">{i18n.t("updatingSharing", { ns: "sharing" })}</p>}
        </DialogContent>
        <DialogActions>
          {status.data && !status.isError && !status.isFetching && !confirm && (
            <>
              {!status.data.enabled && (
                <Button
                  disabled={action.isPending}
                  onClick={() => run("enable")}
                >
                  {i18n.t("enableSharing", { ns: "sharing" })}</Button>
              )}
              {status.data.enabled && (
                <>
                  {link && (
                    <Button
                      disabled={action.isPending}
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(link);
                          setNotice("sharing:linkCopied");
                          setCopyError(false);
                        } catch {
                          setCopyError(true);
                        }
                      }}
                    >
                      {i18n.t("copyLink", { ns: "sharing" })}</Button>
                  )}
                  <Button
                    disabled={action.isPending}
                    onClick={() => setConfirm("rotate")}
                  >
                    {i18n.t("rotateLink", { ns: "sharing" })}</Button>
                  <Button
                    disabled={action.isPending}
                    onClick={() => setConfirm("disable")}
                  >
                    {i18n.t("disableSharing", { ns: "sharing" })}</Button>
                </>
              )}
            </>
          )}
          <Button disabled={action.isPending} onClick={close}>
            {t("close", { ns: "common" })}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
