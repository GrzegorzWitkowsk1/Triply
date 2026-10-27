import LanguageSwitcher from "../LanguageSwitcher";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import {
  LogoutOutlined,
  NotificationsNoneOutlined,
  PersonOutlineOutlined,
} from "@mui/icons-material";
import { NavLink, Link } from "react-router-dom";
import { useNotifications } from "../../hooks/useNotifications";
import { useAuth } from "../../auth/AuthProvider";
import Logo from "../Logo";
import { useState } from "react";

const TABS = [
  { to: "/trips", label: "myTrips" },
  { to: "/explore", label: "explore" },
  { to: "/saved", label: "saved" },
];

export default function Header() {
  const { t } = useTranslation("navigation", { i18n });
  const { data: notifications } = useNotifications();
  const { user, isGuest, logout, endGuest, isLoggingOut } = useAuth();
  const [exitError, setExitError] = useState(false);
  const unreadCount =
    notifications?.filter((notification) => !notification.isRead).length ?? 0;

  return (
    <header className={`app-header${isGuest ? " guest-header" : ""}`}>
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
              {t(tab.label)}
            </NavLink>
          ))}
        </nav>

        <div className="header-actions">
          {!user ? <>{isGuest && <span className="guest-indicator">{i18n.t("guest", { ns: "navigation" })}</span>}<Link className="auth-link" to="/register">{i18n.t("createAccount", { ns: "auth" })}</Link><Link className="auth-link" to="/login">{i18n.t("logIn", { ns: "auth" })}</Link></> : <>
          <Link
            to="/notifications"
            className="header-icon header-notif"
            aria-label={i18n.t("notifications", { ns: "navigation" })}
          >
            <NotificationsNoneOutlined />
            {unreadCount > 0 && <span className="header-notif-dot" />}
          </Link>
          <Link to="/profile" className="user-btn" aria-label={t("profile")}>
            <span className="user-icon">
              <PersonOutlineOutlined />
            </span>
            <span className="user-email">{user?.email}</span>
          </Link>
          </>}
          {(user || isGuest) && <button
            type="button"
            className="header-icon logout-btn"
            aria-label={isGuest ? i18n.t("endGuestSession", { ns: "navigation" }) : i18n.t("signOut", { ns: "navigation" })}
            onClick={() => {
              setExitError(false);
              void (isGuest ? endGuest() : logout()).catch(() => setExitError(true));
            }}
            disabled={isLoggingOut}
          >
            <LogoutOutlined />
          </button>}
          {exitError && <span role="alert">{i18n.t("couldNotEndSessionTryAgain", { ns: "navigation" })}</span>}
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}
