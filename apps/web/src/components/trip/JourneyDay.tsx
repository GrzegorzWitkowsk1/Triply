import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button, Chip } from "@mui/material";
import { OpenInNewOutlined } from "@mui/icons-material";
import type { ItineraryDay, TripExpense, VisitProgress, VisitStatus } from "@triply/shared";
import { journeyItems, navigationUrl } from "../../config/journey";
import { formatClock, formatDuration } from "../../config/itineraryAdapters";
import { formatMoney } from "../../i18n/format";
import VisitControls from "./VisitControls";

export default function JourneyDay({ day, visits = [], expenses = [], active, saving, visible, onSelect, onVisit }: {
  day?: ItineraryDay; visits?: VisitProgress[]; expenses?: TripExpense[]; active: number; saving: boolean; visible: boolean;
  onSelect: (index: number) => void; onVisit: (itemId: string, status: VisitStatus) => void;
}) {
  const { t } = useTranslation("itinerary/journey");
  const list = useRef<HTMLOListElement>(null);
  const lastSelection = useRef<number | null>(null);
  const items = day ? journeyItems(day) : [];
  const status = (id?: string): VisitStatus => visits.find(record => record.itineraryItemId === id)?.status ?? "planned";
  const next = items.find(({ item }) => status(item.itineraryItemId) === "planned");
  useEffect(() => {
    const previous = lastSelection.current; lastSelection.current = active;
    if (!visible || previous === null || previous === active) return;
    list.current?.querySelector<HTMLElement>(`[data-journey-stop="${active}"]`)?.scrollIntoView?.({ block: "nearest", behavior: "instant" });
  }, [active, visible]);
  if (!items.length) return <div className="trip-empty-day"><h3>{t("emptyDay")}</h3><p>{t("emptyDayHelp")}</p></div>;
  return <section className="journey-day" aria-label={t("dayJourney")}>
    <div className="journey-next-summary">
      <h2>{t("dayJourney")}</h2>
      {next ? <Button onClick={() => {
        if (next.stopIndex >= 0) onSelect(next.stopIndex);
        const card = list.current?.querySelector<HTMLElement>("[data-next-visit]");
        card?.scrollIntoView?.({ block: "nearest", behavior: "instant" }); card?.querySelector<HTMLButtonElement>(".journey-place-select")?.focus();
      }}>{t("goToNext", { name: next.item.title })}</Button> : <p>{t("noRemaining")}</p>}
    </div>
    <ol className="journey-list" ref={list}>
      {items.map(({ item, stop, stopIndex }, index) => {
        const currentStatus = status(item.itineraryItemId);
        const isNext = next?.item === item;
        const url = navigationUrl(stop);
        const linked = expenses.filter(expense => expense.type === "actual" && item.itineraryItemId && expense.itineraryItemId === item.itineraryItemId);
        return <li key={item.itineraryItemId ?? `legacy-${index}`} className={`journey-place is-${currentStatus}${isNext ? " is-next" : ""}${active >= 0 && active === stopIndex ? " is-selected" : ""}`}
          data-journey-stop={stopIndex} data-next-visit={isNext || undefined}>
          {isNext && <span className="journey-next-label">{t("nextPlanned")}</span>}
          <button type="button" className="journey-place-select" aria-pressed={stopIndex >= 0 && active === stopIndex} disabled={stopIndex < 0} onClick={() => onSelect(stopIndex)}>
            <span className="journey-place-name">{item.title}</span>
            <span className="journey-place-time">{item.schedulingStatus === "unresolved" || !item.startTime ? t("timeUnavailable") : formatClock(item.startTime)}
              {item.durationMinutes > 0 && Number.isFinite(item.durationMinutes) ? ` · ${formatDuration(item.durationMinutes)}` : ""}</span>
          </button>
          {item.itineraryItemId ? <VisitControls itemId={item.itineraryItemId} name={item.title} status={currentStatus} disabled={saving} onChange={onVisit} />
            : <Chip size="small" label={t("planned", { ns: "itinerary/visits" })} />}
          {linked.length > 0 && <ul className="journey-linked-expenses" aria-label={t("linkedExpenses", { name: item.title })}>{linked.map(expense => <li key={expense.id}><span>{expense.title}</span><strong>{formatMoney(expense.amountMinor, expense.currency)}</strong></li>)}</ul>}
          {url ? <Button component="a" href={url} target="_blank" rel="noopener noreferrer" endIcon={<OpenInNewOutlined />} title={t("navigateLabel", { name: item.title })} aria-label={t("navigateLabel", { name: item.title })}>{t("navigate")}</Button>
            : <p className="journey-location-unavailable">{t("navigationUnavailable")}</p>}
        </li>;
      })}
    </ol>
  </section>;
}
