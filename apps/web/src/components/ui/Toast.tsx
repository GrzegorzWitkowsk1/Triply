import { Alert, Snackbar } from "@mui/material";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

export type ToastSeverity = "success" | "error" | "info";

interface ToastState {
  message: string;
  severity: ToastSeverity;
}

interface ToastContextValue {
  showToast: (message: string, severity?: ToastSeverity) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: PropsWithChildren) {
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback(
    (message: string, severity: ToastSeverity = "success") => {
      setToast({ message, severity });
    },
    [],
  );

  const handleClose = useCallback(
    (_event?: unknown, reason?: string) => {
      if (reason === "clickaway") {
        return;
      }

      setToast(null);
    },
    [],
  );

  const value = useMemo<ToastContextValue>(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Snackbar
        open={toast !== null}
        autoHideDuration={4000}
        onClose={handleClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          className="app-toast"
          onClose={handleClose}
          severity={toast?.severity ?? "success"}
          variant="filled"
        >
          {toast?.message ?? ""}
        </Alert>
      </Snackbar>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }

  return context;
}
