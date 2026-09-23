import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./components/layout/AppLayout";
import ScrollToTop from "./components/layout/ScrollToTop";
import LoginPage from "./components/LoginPage";
import ExplorePage from "./pages/ExplorePage";
import HomePage from "./pages/HomePage";
import MyTripsPage from "./pages/MyTripsPage";
import NotificationsPage from "./pages/NotificationsPage";
import ProfilePage from "./pages/ProfilePage";
import SavedPage from "./pages/SavedPage";
import TripPage from "./pages/TripPage";

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route element={<AppLayout />}>
          <Route path="/home" element={<HomePage />} />
          <Route path="/trips" element={<MyTripsPage />} />
          <Route path="/trips/:id" element={<TripPage />} />
          <Route path="/explore" element={<ExplorePage />} />
          <Route path="/saved" element={<SavedPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}