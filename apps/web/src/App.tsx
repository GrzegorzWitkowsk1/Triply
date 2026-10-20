import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { PublicOnlyRoute, RequireAuth } from "./auth/RouteGuards";
import AppLayout from "./components/layout/AppLayout";
import ScrollToTop from "./components/layout/ScrollToTop";
import LoginPage from "./components/LoginPage";
import ExplorePage from "./pages/ExplorePage";
import CollectionPage from "./pages/CollectionPage";
import HomePage from "./pages/HomePage";
import MyTripsPage from "./pages/MyTripsPage";
import NotificationsPage from "./pages/NotificationsPage";
import ProfilePage from "./pages/ProfilePage";
import SavedPage from "./pages/SavedPage";
import TripPage from "./pages/TripPage";
import TripEquipmentPage from "./pages/TripEquipmentPage";
import SharedTripPage from "./pages/SharedTripPage";
import { GuestAwarePage } from "./pages/GuestPage";

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route element={<AppLayout />}><Route path="/explore" element={<ExplorePage />} /><Route path="/explore/collections/:slug" element={<CollectionPage />} /></Route>
        <Route path="/shared/:shareToken" element={<SharedTripPage />} />
        <Route
          path="/"
          element={
            <PublicOnlyRoute>
              <Navigate to="/login" replace />
            </PublicOnlyRoute>
          }
        />
        <Route
          path="/login"
          element={
            <PublicOnlyRoute>
              <LoginPage mode="login" />
            </PublicOnlyRoute>
          }
        />
        <Route
          path="/register"
          element={
            <PublicOnlyRoute>
              <LoginPage mode="register" />
            </PublicOnlyRoute>
          }
        />
        <Route
          element={
            <RequireAuth allowGuest>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route path="/home" element={<HomePage />} />
          <Route path="/trips" element={<MyTripsPage />} />
          <Route path="/trips/:id" element={<TripPage />} />
          <Route path="/trips/:id/equipment" element={<TripEquipmentPage />} />
          <Route path="/saved" element={<SavedPage />} />
          <Route path="/notifications" element={<GuestAwarePage><NotificationsPage /></GuestAwarePage>} />
          <Route path="/profile" element={<GuestAwarePage><ProfilePage /></GuestAwarePage>} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
