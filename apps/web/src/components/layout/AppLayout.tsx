import { Outlet } from "react-router-dom";
import Header from "./Header";
import BottomNav from "./BottomNav";
import GuestUsage from "../GuestUsage";
import GuestMigration from "../GuestMigration";

export default function AppLayout() {
  return (
    <>
      <Header />
      <main className="app-content">
        <GuestMigration />
        <GuestUsage />
        <Outlet />
      </main>
      <BottomNav />
    </>
  );
}
