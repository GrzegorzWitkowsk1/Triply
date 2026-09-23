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
  const hasTrip = Boolean(notification.tripId);
  return (
    <button
      type="button"
      className={`notification-row${notification.isRead ? " is-read" : ""}`}
      onClick={() => onSelect(notification.tripId)}
    >
      <NotificationIcon type={notification.notificationType} isRead={notification.isRead} />
      <div className="notification-row-body">
        <span className="notification-row-title">{notification.title}</span>
        <span className="notification-row-message">{notification.message}</span>
        {hasTrip && (
          <span className="notification-row-cta">Review changes →</span>
        )}
      </div>
      <span className="notification-row-date">
        {formatNotificationDate(notification.createdAt)}
      </span>
    </button>
  );
}

export default function NotificationsPage() {
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
        <p className="notifications-eyebrow">Stay in the loop</p>

        <div className="notifications-head">
          <div className="notifications-head-copy">
            <h1 className="notifications-title">Notifications</h1>
            <p className="notifications-subtitle">
              {unread.length} updates need your attention
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
              Mark all as read
            </button>
          )}
        </div>

        <div className="notifications-filters">
          <button
            type="button"
            className={`notifications-filter${filter === "all" ? " is-active" : ""}`}
            onClick={() => setFilter("all")}
          >
            All
          </button>
          <button
            type="button"
            className={`notifications-filter${filter === "unread" ? " is-active" : ""}`}
            onClick={() => setFilter("unread")}
          >
            Unread
          </button>
        </div>

        <div className="notifications-divider" />

        {notifications === undefined ? (
          <p className="notifications-empty">Loading notifications…</p>
        ) : filtered.length === 0 ? (
          <p className="notifications-empty">No notifications here.</p>
        ) : (
          <>
            {today.length > 0 && (
              <section className="notifications-section">
                <h2 className="notifications-section-title">Today</h2>
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
                <h2 className="notifications-section-title">Earlier</h2>
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