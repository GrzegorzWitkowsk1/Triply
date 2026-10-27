import i18n, { getSelectedLanguage } from "../i18n";
export function guestDataSummary(trips: number, destinations: number, attractions: number): string {
  const values = [[trips, "trips"], [destinations, "destinations"], [attractions, "attractions"]] as const;
  return new Intl.ListFormat(getSelectedLanguage(), { style: "long", type: "conjunction" }).format(
    values.filter(([count]) => count > 0).map(([count, name]) => i18n.t(name, { ns: "auth/migration", count })),
  );
}
