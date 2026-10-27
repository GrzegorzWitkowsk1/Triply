import { Alert, Snackbar } from "@mui/material";
import { useTranslation } from "react-i18next";
import { resolveMessage } from "../i18n/errors";
import { createContext, useCallback, useContext, useState, type PropsWithChildren } from "react";
type ToastMessage = string | (() => string);
type Toast = { id: number; message: ToastMessage; severity: "success" | "error" };
const ToastContext = createContext<((message: ToastMessage, severity?: Toast["severity"]) => void) | null>(null);
export function ToastProvider({ children }: PropsWithChildren) {
  const { t } = useTranslation("common");
  const [toast, setToast] = useState<Toast | null>(null);
  const showToast = useCallback((message: ToastMessage, severity: Toast["severity"] = "success") => {
    setToast({ id: Date.now() + Math.random(), message, severity });
  }, []);
  const close = () => setToast(null);
  return <ToastContext.Provider value={showToast}>{children}<Snackbar key={toast?.id} open={!!toast} autoHideDuration={6000} anchorOrigin={{ vertical: "bottom", horizontal: "right" }} onClose={(_event, reason) => { if (reason !== "clickaway") close(); }}>
    <Alert severity={toast?.severity ?? "success"} onClose={close} closeText={t("close")} variant="filled">{resolveMessage(typeof toast?.message === "function" ? toast.message() : toast?.message)}</Alert>
  </Snackbar></ToastContext.Provider>;
}
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider");
  return context;
}
