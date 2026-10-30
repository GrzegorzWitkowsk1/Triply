import { Outlet } from "react-router-dom";
import Header from "./Header";
import BottomNav from "./BottomNav";
import GuestUsage from "../GuestUsage";
import GuestMigration from "../GuestMigration";
import { useTranslation } from "react-i18next";

export default function AppLayout() {
  const { t } = useTranslation("common");
  return (
    <>
      <a className="skip-link" href="#main-content">{t("skipToContent")}</a>
      <Header />
      <main id="main-content" tabIndex={-1} className="app-content">
        <GuestMigration />
        <GuestUsage />
        <Outlet />
      </main>
      <BottomNav />
    </>
  );
}
