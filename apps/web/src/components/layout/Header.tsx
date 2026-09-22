import {
  ExploreOutlined,
  FavoriteBorderOutlined,
  MapOutlined,
  NotificationsNoneOutlined,
  PersonOutlineOutlined,
} from "@mui/icons-material";
import { NavLink } from "react-router-dom";
import Logo from "../Logo";

const USER_EMAIL = "user@triply.app";

const TABS = [
  { to: "/trips", label: "my trips" },
  { to: "/explore", label: "explore" },
  { to: "/saved", label: "saved" },
];

export default function Header() {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Logo />

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
          <button type="button" className="user-btn">
            <span className="user-icon">
              <PersonOutlineOutlined />
            </span>
            <span className="user-email">{USER_EMAIL}</span>
          </button>
        </div>
      </div>
    </header>
  );
}