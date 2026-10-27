import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import {
  ExploreOutlined,
  FavoriteBorderOutlined,
  MapOutlined,
  PersonOutlineOutlined,
} from "@mui/icons-material";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";

const ITEMS = [
  { to: "/trips", label: "trips", icon: MapOutlined },
  { to: "/explore", label: "explore", icon: ExploreOutlined },
  { to: "/saved", label: "saved", icon: FavoriteBorderOutlined },
  { to: "/profile", label: "profile", icon: PersonOutlineOutlined },
];

export default function BottomNav() {
  const { t } = useTranslation("navigation", { i18n });
  const { isGuest } = useAuth();
  return (
    <nav className="bottom-nav">
      {ITEMS.filter(item => !isGuest || item.to !== "/profile").map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `bottom-nav-item${isActive ? " is-active" : ""}`
            }
          >
            <Icon />
            <span>{t(item.label)}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
