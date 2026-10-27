import i18n from "../i18n";
import enCalendar from "../i18n/locales/en/sharing/calendar.json";
export function calendarMessages() {
  const keys = Object.keys(enCalendar).filter(key => key !== "result" && !/^(events|excluded)_/.test(key));
  const labels = Object.fromEntries(keys.map(key => [key, i18n.t(key, { ns: "sharing/calendar" })])) as
    Record<Exclude<keyof typeof enCalendar, "result" | `events_${string}` | `excluded_${string}`>, string>;
  return { ...labels, "network-error": i18n.t("networkError", { ns: "errors" }),
    result: (exported: number, excluded: number) => i18n.t("result", { ns: "sharing/calendar", exported, excluded }) };
}
