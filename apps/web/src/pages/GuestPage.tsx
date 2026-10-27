import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

export function GuestAwarePage({ children }: { children: ReactNode }) {
  useTranslation();
  const { isGuest } = useAuth();
  if (!isGuest) return <>{children}</>;
  return <section className="auth-status guest-welcome">
    <h1>{i18n.t("welcomeToTriply", { ns: "auth/guest" })}</h1>
    <p>{i18n.t("youReBrowsingAsAGuestAccountSettings", { ns: "auth/guest" })}</p>
    <p>{i18n.t("youCanPlanAndEditTripsAsA", { ns: "auth/guest" })}</p>
    <Link className="btn btn-primary" to="/register">{i18n.t("createAccount", { ns: "auth" })}</Link>
    <Link className="auth-link" to="/login">{i18n.t("logIn", { ns: "auth" })}</Link>
  </section>;
}
