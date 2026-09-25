import {
  LogoutOutlined,
  NotificationsNoneOutlined,
  PersonOutlineOutlined,
} from "@mui/icons-material";
import { NavLink, Link } from "react-router-dom";
import { useNotifications } from "../../hooks/useNotifications";
import { useAuth } from "../../auth/AuthProvider";
import Logo from "../Logo";

const TABS = [
  { to: "/trips", label: "My Trips" },
  { to: "/explore", label: "Explore" },
  { to: "/saved", label: "Saved" },
];

export default function Header() {
  const { data: notifications } = useNotifications();
  const { user, logout, isLoggingOut } = useAuth();
  const unreadCount =
    notifications?.filter((notification) => !notification.isRead).length ?? 0;

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link to="/home" className="logo-link">
          <Logo />
        </Link>

        <nav className="header-tabs">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                `header-tab${isActive ? " is-active" : ""}`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>

        <div className="header-actions">
          <Link
            to="/notifications"
            className="header-icon header-notif"
            aria-label="Notifications"
          >
            <NotificationsNoneOutlined />
            {unreadCount > 0 && <span className="header-notif-dot" />}
          </Link>
          <Link to="/profile" className="user-btn">
            <span className="user-icon">
              <PersonOutlineOutlined />
            </span>
            <span className="user-email">{user?.email}</span>
          </Link>
          <button
            type="button"
            className="header-icon logout-btn"
            aria-label="Sign out"
            onClick={() => {
              void logout().catch(() => undefined);
            }}
            disabled={isLoggingOut}
          >
            <LogoutOutlined />
          </button>
        </div>
      </div>
    </header>
  );
}
