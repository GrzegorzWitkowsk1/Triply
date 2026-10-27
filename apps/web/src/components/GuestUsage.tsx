import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useGuestUsage } from "../hooks/useGuestUsage";
import { formatDate } from "../i18n/format";
import { errorMessage } from "../i18n/errors";

export default function GuestUsage() {
  const { t } = useTranslation("auth/guest");
  const usage = useGuestUsage();
  if (!usage.isGuest) return null;
  if (usage.isPending) return <aside className="guest-usage" role="status">{t("loading")}</aside>;
  if (usage.isError) return <aside className="guest-usage" role="alert">{errorMessage(usage.error)} <button className="auth-link" onClick={() => void usage.refetch()}>{t("retry", { ns: "common" })}</button></aside>;
  const u = usage.data;
  if (!u) return null;
  const allowance = (date: string) => <time dateTime={date}>{t("nextAllowance", { date: formatDate(date, { dateStyle: "medium", timeStyle: "short" }) })}</time>;
  return <aside className="guest-usage" aria-label={t("usage")}>
    <strong>{t("mode")}</strong>
    <span>{t("tripsUsed", { used: u.tripCount, limit: u.tripLimit })}</span>
    <span>{t("generationsLeft", { remaining: u.aiGenerationsRemaining, limit: u.aiGenerationsLimit })}</span>
    <span>{t("regenerationsLeft", { remaining: u.dayRegenerationsRemaining, limit: u.dayRegenerationsLimit })}</span>
    <span>{t("maxDays", { count: u.maxTripDays })}</span>
    {u.tripCount >= u.tripLimit && <p><Trans ns="auth/guest" i18nKey="tripLimit" count={u.tripLimit} components={{ account: <Link to="/register" />, trips: <Link to="/trips" /> }} /></p>}
    {u.aiGenerationsRemaining === 0 && <p>{t("generationLimit", { count: u.aiGenerationsLimit })} {u.aiQuotaResetsAt && allowance(u.aiQuotaResetsAt)}</p>}
    {u.dayRegenerationsRemaining === 0 && <p>{t("dayLimit")} {u.dayQuotaResetsAt && allowance(u.dayQuotaResetsAt)}</p>}
    <small>{t("importHint")}</small>
  </aside>;
}
