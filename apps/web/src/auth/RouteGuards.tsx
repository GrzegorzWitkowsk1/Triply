import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";

function AuthLoading() {
  return (
    <div className="auth-status" role="status" aria-live="polite">
      <span className="auth-status-spinner" aria-hidden="true" />
      <p>Checking your session...</p>
    </div>
  );
}

function AuthErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="auth-status" role="alert">
      <p>We could not check your session. Please try again.</p>
      <button type="button" className="btn btn-primary auth-status-button" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading, error, refetchSession } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <AuthLoading />;
  }

  if (error) {
    return <AuthErrorState onRetry={() => void refetchSession()} />;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}

export function PublicOnlyRoute({ children }: { children: ReactNode }) {
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
