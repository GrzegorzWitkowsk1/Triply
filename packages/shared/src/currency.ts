export const CURRENCY_CODES = [
  "EUR",
  "USD",
  "GBP",
  "PLN",
  "CHF",
  "CZK",
  "SEK",
  "NOK",
  "DKK",
  "JPY",
] as const;

export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export interface CurrencyOption {
  code: CurrencyCode;
  symbol: string;
  label: string;
}

export const CURRENCY_OPTIONS_SHARED: CurrencyOption[] = [
  { code: "EUR", symbol: "€", label: "EUR" },
  { code: "USD", symbol: "$", label: "USD" },
  { code: "GBP", symbol: "£", label: "GBP" },
  { code: "PLN", symbol: "zł", label: "PLN" },
  { code: "CHF", symbol: "CHF", label: "CHF" },
  { code: "CZK", symbol: "Kč", label: "CZK" },
  { code: "SEK", symbol: "kr", label: "SEK" },
  { code: "NOK", symbol: "kr", label: "NOK" },
  { code: "DKK", symbol: "kr", label: "DKK" },
  { code: "JPY", symbol: "¥", label: "JPY" },
];

const CURRENCY_SYMBOLS: Record<string, CurrencyCode> = {
  eur: "EUR",
  euro: "EUR",
  euros: "EUR",
  "€": "EUR",
  usd: "USD",
  dollar: "USD",
  dollars: "USD",
  buck: "USD",
  bucks: "USD",
  $: "USD",
  us$: "USD",
  gbp: "GBP",
  pound: "GBP",
  pounds: "GBP",
  sterling: "GBP",
  "£": "GBP",
  pln: "PLN",
  zloty: "PLN",
  zl: "PLN",
  zlotys: "PLN",
  zlote: "PLN",
  zlotych: "PLN",
  "zł": "PLN",
  "złoty": "PLN",
  "złote": "PLN",
  "złotych": "PLN",
  "złotów": "PLN",
  chf: "CHF",
  frank: "CHF",
  franken: "CHF",
  franc: "CHF",
  czk: "CZK",
  koruna: "CZK",
  koruny: "CZK",
  korun: "CZK",
  "kc": "CZK",
  "kč": "CZK",
  sek: "SEK",
  swedishkrona: "SEK",
  "swedish krona": "SEK",
  nok: "NOK",
  norwegiankrone: "NOK",
  "norwegian krone": "NOK",
  dkk: "DKK",
  danishkrone: "DKK",
  "danish krone": "DKK",
  jpy: "JPY",
  yen: "JPY",
  "¥": "JPY",
};

function fold(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

const CURRENCY_SYMBOL_BY_CODE = new Map(
  CURRENCY_OPTIONS_SHARED.map((option) => [option.code, option.symbol]),
);

export function currencySymbol(code: string | null): string {
  if (!code) {
    return "";
  }

  if (code && (CURRENCY_CODES as readonly string[]).includes(code)) {
    return CURRENCY_SYMBOL_BY_CODE.get(code as CurrencyCode) ?? `${code} `;
  }

  return code ? `${code} ` : "";
}

export function normalizeCurrencyCode(value: unknown): CurrencyCode | null {
  if (typeof value !== "string") {
    return null;
  }

  const folded = fold(value);

  if (folded.length === 0) {
    return null;
  }

  const alias = CURRENCY_SYMBOLS[folded];

  if (alias) {
    return alias;
  }

  const upper = folded.toUpperCase();

  const exact = CURRENCY_CODES.find((code) => code === upper) as CurrencyCode | undefined;

  if (exact) {
    return exact;
  }

  return (CURRENCY_CODES.find((code) => fold(code) === folded) as CurrencyCode | undefined) ?? null;
}