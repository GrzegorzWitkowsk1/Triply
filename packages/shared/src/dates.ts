const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

function toUtcDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }

  const date = toUtcDate(value);

  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function addDays(isoDate: string, days: number): string {
  const date = toUtcDate(isoDate);
  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

export function diffDaysInclusive(startDate: string, endDate: string): number {
  return Math.round((toUtcDate(endDate).getTime() - toUtcDate(startDate).getTime()) / MS_PER_DAY) + 1;
}

export function isAfter(first: string, second: string): boolean {
  return toUtcDate(first).getTime() > toUtcDate(second).getTime();
}