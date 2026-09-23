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
    title: "Rain expected in Prague tomorrow",
    message:
      "We refined the Day 2 route around the rain forecast. Your 3 stops stay within a 10-minute walk.",
    createdAt: minutesAgo(12),
    city: "Prague",
    tripId: "prague",
    notificationType: "rain",
    isRead: false,
  },
  {
    id: "notif-2",
    title: "Your Prague itinerary is ready",
    message:
      "Day 1 is confirmed: Old Town square, the Astronomical Clock and a spot of Czech food. Enjoy!",
    createdAt: hoursAgo(2),
    city: "Prague",
    tripId: "prague",
    notificationType: "trip",
    isRead: false,
  },
  {
    id: "notif-3",
    title: "You're close to your Rome budget",
    message:
      "Spending is 12% over the daily plan. Swapping two meals to market snacks keeps you on track.",
    createdAt: hoursAgo(5),
    city: "Rome",
    tripId: "rome",
    notificationType: "budget",
    isRead: false,
  },
  {
    id: "notif-4",
    title: "Price drop on your Paris flight",
    message:
      "Round-trip tickets for your Feb trip dropped by €24. The new fare is available until tomorrow.",
    createdAt: daysAgo(1),
    city: "Paris",
    tripId: "paris",
    notificationType: "budget",
    isRead: false,
  },
  {
    id: "notif-5",
    title: "New walking-friendly route for Lisbon",
    message:
      "We found a shorter path between Belém and LX Factory that saves about 20 minutes of walking.",
    createdAt: daysAgo(8),
    city: "Lisbon",
    tripId: "lisbon",
    notificationType: "rain",
    isRead: true,
  },
  {
    id: "notif-6",
    title: "Welcome to Triply",
    message:
      "Plan a trip in seconds — describe your dream day and we'll build a walkable itinerary for you.",
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
      return diffMinutes <= 1 ? "1 min ago" : `${diffMinutes} min ago`;
    }
    const diffHours = Math.floor(diffMinutes / 60);
    return diffHours === 1 ? "1 hr ago" : `${diffHours} hrs ago`;
  }

  if (isYesterday(date)) {
    return "Yesterday";
  }

  return `${date.getDate()} ${date.toLocaleString("en-GB", {
    month: "short",
  })}, ${date.getFullYear()}`;
}

export function groupNotificationDate(createdAt: string): "today" | "earlier" {
  return isSameDay(new Date(createdAt), new Date()) ? "today" : "earlier";
}