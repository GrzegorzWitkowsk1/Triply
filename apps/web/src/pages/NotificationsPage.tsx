import { NOTIFICATIONS } from "../config/notifications";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarMonthOutlined,
  DoneAllOutlined,
  PaymentsOutlined,
  ThunderstormOutlined,
} from "@mui/icons-material";
import {
  formatNotificationDate,
  groupNotificationDate,
  Notification,
  NotificationType,
} from "../config/notifications";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "../hooks/useNotifications";

interface NotificationIconProps {
  type: NotificationType;
  isRead: boolean;
}

function NotificationIcon({ type, isRead }: NotificationIconProps) {
  useTranslation();
  let icon = null;
  if (type === "rain") icon = <ThunderstormOutlined />;
  if (type === "budget") icon = <PaymentsOutlined />;
  if (type === "trip") icon = <CalendarMonthOutlined />;

  return (
    <span className={`notification-icon is-${type}`}>
      {icon}
      {!isRead && <span className="notification-icon-dot" />}
    </span>
  );
}

interface NotificationRowProps {
  notification: Notification;
  onSelect: (tripId?: string) => void;
}

function NotificationRow({ notification, onSelect }: NotificationRowProps) {
  useTranslation();
  const hasTrip = Boolean(notification.tripId);
  const copy = NOTIFICATIONS.find(item => item.id === notification.id) ?? notification;
  return (
    <button
      type="button"
      className={`notification-row${notification.isRead ? " is-read" : ""}`}
      onClick={() => onSelect(notification.tripId)}
    >
      <NotificationIcon type={notification.notificationType} isRead={notification.isRead} />
      <div className="notification-row-body">
        <span className="notification-row-title">{copy.title}</span>
        <span className="notification-row-message">{copy.message}</span>
        {hasTrip && (
          <span className="notification-row-cta">{i18n.t("reviewChanges", { ns: "navigation/notifications" })}</span>
        )}
      </div>
      <span className="notification-row-date">
        {formatNotificationDate(notification.createdAt)}
      </span>
    </button>
  );
}

export default function NotificationsPage() {
  useTranslation();
  const navigate = useNavigate();
  const { data: notifications } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const [filter, setFilter] = useState<"all" | "unread">("all");

  const unread = notifications?.filter((notification) => !notification.isRead) ?? [];
  const filtered =
    filter === "unread"
      ? unread
      : notifications ?? [];

  const today: Notification[] = [];
  const earlier: Notification[] = [];

  for (const notification of filtered) {
    if (groupNotificationDate(notification.createdAt) === "today") {
      today.push(notification);
    } else {
      earlier.push(notification);
    }
  }

  const handleSelect = (tripId?: string) => {
    if (tripId) {
      markRead.mutate(tripId);
      navigate(`/trips/${tripId}`);
    }
  };

  const totalCount = notifications?.length ?? 0;

  return (
    <div className="notifications-page">
      <div className="notifications-inner">
        <p className="notifications-eyebrow">{i18n.t("stayInTheLoop", { ns: "navigation/notifications" })}</p>

        <div className="notifications-head">
          <div className="notifications-head-copy">
            <h1 className="notifications-title">{i18n.t("notifications", { ns: "navigation/notifications" })}</h1>
            <p className="notifications-subtitle">
              {i18n.t("attentionCount", { ns: "navigation/notifications", count: unread.length })}
            </p>
          </div>
          {totalCount > 0 && (
            <button
              type="button"
              className="notifications-mark-all"
              onClick={() => markAllRead.mutate()}
              disabled={unread.length === 0}
            >
              <DoneAllOutlined />
              {i18n.t("markAllAsRead", { ns: "navigation/notifications" })}</button>
          )}
        </div>

        <div className="notifications-filters">
          <button
            type="button"
            className={`notifications-filter${filter === "all" ? " is-active" : ""}`}
            onClick={() => setFilter("all")}
          >
            {i18n.t("all", { ns: "navigation/notifications" })}</button>
          <button
            type="button"
            className={`notifications-filter${filter === "unread" ? " is-active" : ""}`}
            onClick={() => setFilter("unread")}
          >
            {i18n.t("unread", { ns: "navigation/notifications" })}</button>
        </div>

        <div className="notifications-divider" />

        {notifications === undefined ? (
          <p className="notifications-empty">{i18n.t("loadingNotifications", { ns: "navigation/notifications" })}</p>
        ) : filtered.length === 0 ? (
          <p className="notifications-empty">{i18n.t("noNotificationsHere", { ns: "navigation/notifications" })}</p>
        ) : (
          <>
            {today.length > 0 && (
              <section className="notifications-section">
                <h2 className="notifications-section-title">{i18n.t("today", { ns: "navigation/notifications" })}</h2>
                <div className="notifications-card">
                  {today.map((notification) => (
                    <NotificationRow
                      key={notification.id}
                      notification={notification}
                      onSelect={handleSelect}
                    />
                  ))}
                </div>
              </section>
            )}
            {earlier.length > 0 && (
              <section className="notifications-section">
                <h2 className="notifications-section-title">{i18n.t("earlier", { ns: "navigation/notifications" })}</h2>
                <div className="notifications-card">
                  {earlier.map((notification) => (
                    <NotificationRow
                      key={notification.id}
                      notification={notification}
                      onSelect={handleSelect}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}