import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

export function GuestAwarePage({ children }: { children: ReactNode }) {
  const { isGuest } = useAuth();
  if (!isGuest) return <>{children}</>;
  return <section className="auth-status guest-welcome">
    <h1>Welcome to Triply</h1>
    <p>You’re browsing as a guest. Account settings and notifications require an account.</p>
    <p>You can plan and edit trips as a guest. Create an account or log in to access account features.</p>
    <Link className="btn btn-primary" to="/register">Create account</Link>
    <Link className="auth-link" to="/login">Log in</Link>
  </section>;
}
