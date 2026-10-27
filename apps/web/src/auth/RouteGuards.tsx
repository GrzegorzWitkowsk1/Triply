import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { Fragment, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";

function AuthLoading() {
  useTranslation();
  return (
    <div className="auth-status" role="status" aria-live="polite">
      <span className="auth-status-spinner" aria-hidden="true" />
      <p>{i18n.t("checkingYourSession", { ns: "auth/session" })}</p>
    </div>
  );
}

function AuthErrorState({ onRetry }: { onRetry: () => void }) {
  useTranslation();
  return (
    <div className="auth-status" role="alert">
      <p>{i18n.t("weCouldNotCheckYourSessionPleaseTry", { ns: "auth/session" })}</p>
      <button type="button" className="btn btn-primary auth-status-button" onClick={onRetry}>
        {i18n.t("tryAgain", { ns: "common" })}</button>
    </div>
  );
}

export function RequireAuth({ children, allowGuest = false }: { children: ReactNode; allowGuest?: boolean }) {
  useTranslation();
  const { user, guest, isGuest, isLoading, error, refetchSession } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <AuthLoading />;
  }

  if (error) {
    return <AuthErrorState onRetry={() => void refetchSession()} />;
  }

  if (!user && !(allowGuest && isGuest)) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Fragment key={user ? `user:${user.id}` : `guest:${guest?.id}`}>{children}</Fragment>;
}

export function PublicOnlyRoute({ children }: { children: ReactNode }) {
  useTranslation();
  const { user, isLoading, error, refetchSession } = useAuth();

  if (isLoading) {
    return <AuthLoading />;
  }

  if (error) {
    return <AuthErrorState onRetry={() => void refetchSession()} />;
  }

  if (user) {
    return <Navigate to="/home" replace />;
  }

  return <>{children}</>;
}
