import {
  ExploreOutlined,
  FavoriteBorderOutlined,
  MapOutlined,
  NotificationsNoneOutlined,
  PersonOutlineOutlined,
} from "@mui/icons-material";
import { NavLink, Link } from "react-router-dom";
import Logo from "../Logo";

const USER_EMAIL = "user@triply.app";

const TABS = [
  { to: "/trips", label: "My Trips" },
  { to: "/explore", label: "Explore" },
  { to: "/saved", label: "Saved" },
];

export default function Header() {
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
          <button type="button" className="header-icon" aria-label="Notifications">
            <NotificationsNoneOutlined />
          </button>
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