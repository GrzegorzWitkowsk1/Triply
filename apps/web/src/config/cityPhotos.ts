import { DESTINATIONS as cityPhotos } from "@triply/shared";

export type CityPhoto = (typeof cityPhotos)[number];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

const byCityAndCountry = new Map<string, CityPhoto>();
const byCity = new Map<string, CityPhoto>();

for (const photo of cityPhotos) {
  const cityKey = normalize(photo.city);
  const countryKey = normalize(photo.country);

  if (!byCity.has(cityKey)) {
    byCity.set(cityKey, photo);
  }

  const pairKey = `${cityKey}|${countryKey}`;
  if (!byCityAndCountry.has(pairKey)) {
    byCityAndCountry.set(pairKey, photo);
  }
}

export function findCityPhoto(
  city: string | null | undefined,
  country: string | null | undefined,
): CityPhoto | null {
  if (!city) {
    return null;
  }

  const cityKey = normalize(city);

  if (country) {
    const exact = byCityAndCountry.get(`${cityKey}|${normalize(country)}`);
    if (exact) {
      return exact;
    }
  }

  return byCity.get(cityKey) ?? null;
}
