import "./i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import LocaleTheme from "./i18n/LocaleTheme";
import { AuthProvider } from "./auth/AuthProvider";
import App from "./App";
import { queryClient } from "./query/queryClient";
import "./styles.css";
import { ToastProvider } from "./components/ToastProvider";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LocaleTheme>
        <AuthProvider>
          <ToastProvider><App /></ToastProvider>
        </AuthProvider>
      </LocaleTheme>
    </QueryClientProvider>
  </StrictMode>
);
