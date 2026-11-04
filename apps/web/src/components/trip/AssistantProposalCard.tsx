import { useEffect, useRef, useState } from "react";
import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { AssistantActionProposal } from "@triply/shared";
import { ApiError } from "../../api/client";
import i18n from "../../i18n";

export default function AssistantProposalCard({ proposal, itineraryVersion, disabled, onConfirm, onCancel }: {
  proposal: AssistantActionProposal; itineraryVersion?: number; disabled: boolean;
  onConfirm: (id: string) => Promise<unknown>; onCancel: (id: string) => Promise<unknown>;
}) {
  const { t } = useTranslation("assistant", { i18n });
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const statusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (proposal.status !== "pending") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [proposal.status]);
  const status = proposal.status !== "pending" ? proposal.status : new Date(proposal.expiresAt).getTime() <= now ? "expired"
    : itineraryVersion !== undefined && proposal.baseItineraryVersion !== itineraryVersion ? "stale" : "pending";
  const perform = async (confirm: boolean) => {
    if (lock.current || disabled) return;
    lock.current = true; setBusy(true); setError(null);
    try { await (confirm ? onConfirm : onCancel)(proposal.proposalId); statusRef.current?.focus(); }
    catch (caught) {
      const code = caught instanceof ApiError ? caught.code : undefined;
      setError(code && ["PROPOSAL_STALE", "PROPOSAL_EXPIRED", "PROPOSAL_REJECTED", "PROPOSAL_NOT_FOUND", "VALIDATION_FAILED"].includes(code) ? code : "ACTION_FAILED");
      statusRef.current?.focus();
    } finally { lock.current = false; setBusy(false); }
  };
  return <Box className="assistant-proposal" role="group" aria-labelledby={`proposal-${proposal.proposalId}`} sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 1.5, mt: 1, minWidth: 0, overflowWrap: "anywhere" }}>
    <Typography id={`proposal-${proposal.proposalId}`} component="h3" variant="subtitle2">{t("proposalTitle")}</Typography>
    <Box ref={statusRef} tabIndex={-1} role="status" sx={{ my: 1 }}>{t(`proposalStatus.${status}`)}</Box>
    {proposal.actions.length > 1 && <Typography variant="body2">{t("confirmAllNotice")}</Typography>}
    {proposal.changes.map((change, index) => <Box key={`${change.entityId}-${index}`} sx={{ my: 1 }}>
      <Typography variant="subtitle2">{t(`tools.${change.tool}`)}: {change.label}</Typography>
      <Typography variant="body2">{t("before")}: {change.before ?? t("notPresent")}</Typography>
      <Typography variant="body2">{t("after")}: {change.after ?? t("notPresent")}</Typography>
    </Box>)}
    {proposal.days.map(day => <Box key={day.dayIndex} sx={{ my: 1 }}><Typography variant="subtitle2">{t("day")} {day.dayIndex} · {day.date}</Typography>
      {day.activities.filter(a => a.type === "attraction").map(a => <Typography variant="body2" key={a.placeId}>{a.title}: {a.startTime.slice(11, 16)}–{a.endTime.slice(11, 16)}</Typography>)}
    </Box>)}
    {proposal.warnings.map((warning, index) => <Alert severity="warning" key={index} sx={{ my: 1 }}>{warning}</Alert>)}
    {proposal.conflicts.map((conflict, index) => <Alert severity="error" key={index} sx={{ my: 1 }}>{conflict}</Alert>)}
    {error && status !== "completed" && status !== "rejected" && <Alert severity="error">{t(`actionErrors.${error}`)}</Alert>}
    {proposal.status === "pending" && <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
      <Button variant="contained" disabled={busy || disabled || status !== "pending"} onClick={() => void perform(true)} sx={{ minHeight: 44 }}>{busy ? t("applying") : t("confirmProposal")}</Button>
      <Button disabled={busy || disabled} onClick={() => void perform(false)} sx={{ minHeight: 44 }}>{t("cancelProposal")}</Button>
    </Stack>}
  </Box>;
}
