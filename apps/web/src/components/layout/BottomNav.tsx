import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import {
  ExploreOutlined,
  FavoriteBorderOutlined,
  MapOutlined,
  HomeOutlined,
} from "@mui/icons-material";
import { NavLink } from "react-router-dom";

const ITEMS = [
  { to: "/home", label: "home", icon: HomeOutlined },
  { to: "/trips", label: "trips", icon: MapOutlined },
  { to: "/explore", label: "explore", icon: ExploreOutlined },
  { to: "/saved", label: "saved", icon: FavoriteBorderOutlined },
];

export default function BottomNav() {
  const { t } = useTranslation("navigation", { i18n });
  return (
    <nav className="bottom-nav" aria-label={t("primaryNavigation")}>
      {ITEMS.map((item) => {
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
