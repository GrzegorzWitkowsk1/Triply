// Open-Meteo /v1/forecast: up to 16 calendar days including today.
// https://open-meteo.com/en/docs (forecast_days). Past/archived data is deliberately excluded.
export const WEATHER_POLICY = {
  forecastDays: 16,
  timeoutMs: 3_000,
  totalBudgetMs: 10_000,
  maxRetries: 2,
  backoffMs: 250,
  cacheTtlMs: 24 * 60 * 60 * 1000,
  failureCooldownMs: 10 * 60 * 1000,
} as const;
