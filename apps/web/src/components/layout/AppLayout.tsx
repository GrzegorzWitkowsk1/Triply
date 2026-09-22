import { Outlet } from "react-router-dom";
import Header from "./Header";
import BottomNav from "./BottomNav";

export default function AppLayout() {
  return (
    <>
      <Header />
      <main className="app-content">
        <Outlet />
      </main>
      <BottomNav />
    </>
  );
}