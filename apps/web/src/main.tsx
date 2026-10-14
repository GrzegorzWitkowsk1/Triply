import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@mui/material/styles";
import { AuthProvider } from "./auth/AuthProvider";
import App from "./App";
import { theme } from "./theme";
import { queryClient } from "./query/queryClient";
import "./styles.css";
import { ToastProvider } from "./components/ToastProvider";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <AuthProvider>
          <ToastProvider><App /></ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>
);
