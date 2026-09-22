import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./components/layout/AppLayout";
import LoginPage from "./components/LoginPage";
import HomePage from "./pages/HomePage";
import MyTripsPage from "./pages/MyTripsPage";
import PlaceholderPage from "./pages/PlaceholderPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route element={<AppLayout />}>
          <Route path="/home" element={<HomePage />} />
          <Route path="/trips" element={<MyTripsPage />} />
          <Route path="/explore" element={<PlaceholderPage title="Explore" />} />
          <Route path="/saved" element={<PlaceholderPage title="Saved" />} />
          <Route path="/profile" element={<PlaceholderPage title="Profile" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}