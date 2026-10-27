import LanguageSwitcher from "./LanguageSwitcher";
import { ApiError } from "../api/client";
import { errorKey as localizedErrorKey, resolveMessage } from "../i18n/errors";
import { errorMessage as localizedError } from "../i18n/errors";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { IconButton, InputAdornment, TextField } from "@mui/material";
import {
  CheckCircle,
  LocationOnOutlined,
  VisibilityOffOutlined,
  VisibilityOutlined,
} from "@mui/icons-material";
import { useAuth } from "../auth/AuthProvider";
import Logo from "./Logo";

export type AuthView = "login" | "register";

interface LoginPageProps {
  mode: AuthView;
}

interface FormState {
  email: string;
  password: string;
  showPassword: boolean;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  setShowPassword: (value: boolean) => void;
}

function Fields({
  mode,
  email,
  password,
  showPassword,
  setEmail,
  setPassword,
  setShowPassword,
}: FormState & { mode: AuthView }) {
  useTranslation();
  return (
    <>
      <TextField
        label={i18n.t("emailAddress", { ns: "auth" })}
        fullWidth
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        autoComplete="email"
        required
      />

      <TextField
        label={i18n.t("password", { ns: "auth" })}
        fullWidth
        type={showPassword ? "text" : "password"}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete={mode === "register" ? "new-password" : "current-password"}
        required
        slotProps={{
          htmlInput: {
            minLength: mode === "register" ? 12 : undefined,
            maxLength: 128,
          },
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  aria-label={showPassword ? i18n.t("hidePassword", { ns: "auth" }) : i18n.t("showPassword", { ns: "auth" })}
                  onClick={() => setShowPassword(!showPassword)}
                  size="small"
                >
                  {showPassword ? <VisibilityOffOutlined /> : <VisibilityOutlined />}
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
      />
    </>
  );
}

export default function LoginPage({ mode }: LoginPageProps) {
  const { t } = useTranslation("auth", { i18n });
  const navigate = useNavigate();
  const location = useLocation();
  const { login, register, startGuest, isSubmitting, sessionExpired } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isRegister = mode === "register";

  useEffect(() => {
    setError(null);
  }, [mode]);

  const getDestination = () => {
    const state = location.state as
      | { from?: { pathname: string; search?: string; hash?: string } }
      | null;
    const from = state?.from;

    return from
      ? `${from.pathname}${from.search ?? ""}${from.hash ?? ""}`
      : "/home";
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    try {
      if (isRegister) {
        await register({ email, password });
      } else {
        await login({ email, password });
      }

      navigate(getDestination(), { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 401 ? "auth:invalidCredentials" : caught instanceof ApiError && caught.status === 409 ? "auth:accountExists" : localizedErrorKey(caught));
    }
  };

  const formState = { email, password, showPassword, setEmail, setPassword, setShowPassword };

  return (
    <div className="login-screen">
      <div className="auth-card">
        <div className="auth-media">
          <img src="/barcelona.jpg" alt={i18n.t("heroImage", { ns: "auth" })} />
          <div className="auth-media-fade" />
          <div className="auth-media-body">
            <span className="auth-location">
              <LocationOnOutlined sx={{ color: "var(--color-primary)" }} fontSize="small" />
              {i18n.t("heroImage", { ns: "auth" })}
            </span>
            <h2 className="auth-tagline">
              {i18n.t("aBetterTripStartsWithAPlanThat", { ns: "auth" })}</h2>
            <ul className="auth-features">
              <li>
                <CheckCircle sx={{ color: "var(--color-ok)" }} fontSize="small" />
                {i18n.t("personalItinerariesInSeconds", { ns: "auth" })}</li>
              <li>
                <CheckCircle sx={{ color: "var(--color-ok)" }} fontSize="small" />
                {i18n.t("realisticRoutesAndBudgets", { ns: "auth" })}</li>
            </ul>
          </div>
        </div>

        <div className="auth-panel">
          <div className="auth-brand">
            <Logo />
            <LanguageSwitcher />
          </div>

          <div className="auth-switch" role="group" aria-label={i18n.t("authView", { ns: "auth" })}>
            <button
              type="button"
              className={`auth-switch-btn${!isRegister ? " is-active" : ""}`}
              onClick={() => navigate("/login", { state: location.state })}
              aria-pressed={!isRegister}
            >
              {i18n.t("signIn", { ns: "auth" })}</button>
            <button
              type="button"
              className={`auth-switch-btn${isRegister ? " is-active" : ""}`}
              onClick={() => navigate("/register", { state: location.state })}
              aria-pressed={isRegister}
            >
              {i18n.t("register", { ns: "auth" })}</button>
          </div>

          <form noValidate className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
            <h3 className="auth-heading">
              {t(isRegister ? "createAccountTitle" : "welcomeBack")}
            </h3>
            <p className="auth-subtitle">
              {isRegister
                ? i18n.t("joinTriplyAndKeepEveryThoughtfulItineraryIn", { ns: "auth" })
                : i18n.t("signInToContinuePlanningYourNextAdventure", { ns: "auth" })}
            </p>

            {error && (
              <p className="auth-error" role="alert">
                {resolveMessage(error)}
              </p>
            )}
            {sessionExpired && <p className="auth-error" role="status">{i18n.t("yourGuestSessionHasExpiredEnterGuestMode", { ns: "auth" })}</p>}

            <Fields mode={mode} {...formState} />

            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting
                ? isRegister
                  ? i18n.t("creatingAccount", { ns: "auth" })
                  : i18n.t("signingIn", { ns: "auth" })
                : isRegister
                  ? i18n.t("createAccount", { ns: "auth" })
                  : i18n.t("signIn", { ns: "auth" })}
            </button>

            <button type="button" className="btn" disabled={isSubmitting} onClick={() => {
              setError(null);
              void startGuest().then(() => navigate(getDestination(), { replace: true })).catch((caught: unknown) =>
                setError(localizedErrorKey(caught)));
            }}>{isSubmitting ? i18n.t("pleaseWait", { ns: "auth" }) : i18n.t("continueAsGuest", { ns: "auth" })}</button>
            <p className="auth-switch-link">
              {isRegister ? i18n.t("alreadyHaveAnAccount", { ns: "auth" }) : i18n.t("newToTriply", { ns: "auth" })}
              <button
                type="button"
                className="auth-link"
                onClick={() => navigate(isRegister ? "/login" : "/register", { state: location.state })}
              >
                {isRegister ? i18n.t("signIn", { ns: "auth" }) : i18n.t("createAnAccount", { ns: "auth" })}
              </button>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
