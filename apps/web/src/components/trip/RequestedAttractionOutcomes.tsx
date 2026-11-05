import { useTranslation } from "react-i18next";
import type { RequestedAttractionOutcome } from "@triply/shared";

export default function RequestedAttractionOutcomes({ outcomes }: { outcomes?: RequestedAttractionOutcome[] }) {
  const { t } = useTranslation("tripCreator/home");
  if (!outcomes?.length) return null;
  return <section className="plan-card attachment-outcomes" aria-label={t("attachmentOutcomes")}>
    <p className="plan-title">{t("attachmentOutcomes")}</p>
    <ul>{outcomes.map((outcome, index) => <li key={`${outcome.placeId}:${index}`}>
      {outcome.name} — {t(`attachmentOutcome_${outcome.status}`)}
      {outcome.reason === "provider_unavailable" && ` (${t("attachmentProviderUnavailable")})`}
    </li>)}</ul>
  </section>;
}
