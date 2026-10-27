import { formatDate } from "../i18n/format";
import i18n from "../i18n";
export type NotificationType = "rain" | "budget" | "trip";

export interface Notification {
  id: string;
  title: string;
  message: string;
  createdAt: string;
  city?: string;
  tripId?: string;
  notificationType: NotificationType;
  isRead: boolean;
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export const NOTIFICATIONS: Notification[] = [
  {
    id: "notif-1",
    get title() { return i18n.t("rainExpectedInPragueTomorrow", { ns: "navigation/notifications" }); },
    get message() { return i18n.t("weRefinedTheDay2RouteAroundThe", { ns: "navigation/notifications" }); },
    createdAt: minutesAgo(12),
    city: "Prague",
    tripId: "prague",
    notificationType: "rain",
    isRead: false,
  },
  {
    id: "notif-2",
    get title() { return i18n.t("yourPragueItineraryIsReady", { ns: "navigation/notifications" }); },
    get message() { return i18n.t("day1IsConfirmedOldTownSquareThe", { ns: "navigation/notifications" }); },
    createdAt: hoursAgo(2),
    city: "Prague",
    tripId: "prague",
    notificationType: "trip",
    isRead: false,
  },
  {
    id: "notif-3",
    get title() { return i18n.t("youReCloseToYourRomeBudget", { ns: "navigation/notifications" }); },
    get message() { return i18n.t("spendingIs12OverTheDailyPlanSwapping", { ns: "navigation/notifications" }); },
    createdAt: hoursAgo(5),
    city: "Rome",
    tripId: "rome",
    notificationType: "budget",
    isRead: false,
  },
  {
    id: "notif-4",
    get title() { return i18n.t("priceDropOnYourParisFlight", { ns: "navigation/notifications" }); },
    get message() { return i18n.t("roundTripTicketsForYourFebTripDropped", { ns: "navigation/notifications" }); },
    createdAt: daysAgo(1),
    city: "Paris",
    tripId: "paris",
    notificationType: "budget",
    isRead: false,
  },
  {
    id: "notif-5",
    get title() { return i18n.t("newWalkingFriendlyRouteForLisbon", { ns: "navigation/notifications" }); },
    get message() { return i18n.t("weFoundAShorterPathBetweenBelM", { ns: "navigation/notifications" }); },
    createdAt: daysAgo(8),
    city: "Lisbon",
    tripId: "lisbon",
    notificationType: "rain",
    isRead: true,
  },
  {
    id: "notif-6",
    get title() { return i18n.t("welcomeToTriply", { ns: "navigation/notifications" }); },
    get message() { return i18n.t("welcomeMessage", { ns: "navigation/notifications" }); },
    createdAt: daysAgo(23),
    notificationType: "trip",
    isRead: true,
  },
];

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isYesterday(date: Date): boolean {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return isSameDay(date, yesterday);
}

export function formatNotificationDate(createdAt: string): string {
  const date = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (isSameDay(date, now)) {
    if (diffMinutes < 60) {
      return new Intl.RelativeTimeFormat(i18n.resolvedLanguage, { numeric: "always", style: "short" }).format(-Math.max(1, diffMinutes), "minute");
    }
    const diffHours = Math.floor(diffMinutes / 60);
    return new Intl.RelativeTimeFormat(i18n.resolvedLanguage, { numeric: "always", style: "short" }).format(-diffHours, "hour");
  }

  if (isYesterday(date)) {
    return i18n.t("yesterday", { ns: "navigation/notifications" });
  }

  return formatDate(date, { year: "numeric", month: "short", day: "numeric" });
}

export function groupNotificationDate(createdAt: string): "today" | "earlier" {
  return isSameDay(new Date(createdAt), new Date()) ? "today" : "earlier";
}
