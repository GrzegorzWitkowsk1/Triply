export function guestDataSummary(trips: number, destinations: number, attractions: number): string {
  const values = [[trips, "trip"], [destinations, "destination"], [attractions, "attraction"]] as const;
  return new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(
    values.filter(([count]) => count > 0).map(([count, name]) => `${count} ${name}${count === 1 ? "" : "s"}`),
  );
}
