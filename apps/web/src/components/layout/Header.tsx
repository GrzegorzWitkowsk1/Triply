import {
  ExploreOutlined,
  FavoriteBorderOutlined,
  MapOutlined,
  NotificationsNoneOutlined,
  PersonOutlineOutlined,
} from "@mui/icons-material";
import { NavLink, Link } from "react-router-dom";
import { useNotifications } from "../../hooks/useNotifications";
import Logo from "../Logo";

const USER_EMAIL = "user@triply.app";

const TABS = [
  { to: "/trips", label: "My Trips" },
  { to: "/explore", label: "Explore" },
  { to: "/saved", label: "Saved" },
];

export default function Header() {
  const { data: notifications } = useNotifications();
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
            <span className="user-email">{USER_EMAIL}</span>
          </Link>
        </div>
      </div>
    </header>
  );
}