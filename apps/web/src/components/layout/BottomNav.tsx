import {
  ExploreOutlined,
  FavoriteBorderOutlined,
  MapOutlined,
  PersonOutlineOutlined,
} from "@mui/icons-material";
import { NavLink } from "react-router-dom";

const ITEMS = [
  { to: "/trips", label: "trips", icon: MapOutlined },
  { to: "/explore", label: "explore", icon: ExploreOutlined },
  { to: "/saved", label: "saved", icon: FavoriteBorderOutlined },
  { to: "/profile", label: "profile", icon: PersonOutlineOutlined },
];

export default function BottomNav() {
  return (
    <nav className="bottom-nav">
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
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}