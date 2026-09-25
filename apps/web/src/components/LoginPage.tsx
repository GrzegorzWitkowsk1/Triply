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
  return (
    <>
      <TextField
        label="Email address"
        fullWidth
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        autoComplete="email"
        required
      />

      <TextField
        label="Password"
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
                  aria-label={showPassword ? "Hide password" : "Show password"}
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
  const navigate = useNavigate();
  const location = useLocation();
  const { login, register, isSubmitting } = useAuth();
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
      setError(caught instanceof Error ? caught.message : "Authentication failed. Try again.");
    }
  };

  const formState = { email, password, showPassword, setEmail, setPassword, setShowPassword };

  return (
    <div className="login-screen">
      <div className="auth-card">
        <div className="auth-media">
          <img src="/barcelona.jpg" alt="Barcelona, Spain" />
          <div className="auth-media-fade" />
          <div className="auth-media-body">
            <span className="auth-location">
              <LocationOnOutlined sx={{ color: "var(--color-primary)" }} fontSize="small" />
              Barcelona, Spain
            </span>
            <h2 className="auth-tagline">
              A better trip starts with a plan that feels like you.
            </h2>
            <ul className="auth-features">
              <li>
                <CheckCircle sx={{ color: "var(--color-ok)" }} fontSize="small" />
                Personal itineraries in seconds
              </li>
              <li>
                <CheckCircle sx={{ color: "var(--color-ok)" }} fontSize="small" />
                Realistic routes and budgets
              </li>
            </ul>
          </div>
        </div>

        <div className="auth-panel">
          <div className="auth-brand">
            <Logo />
          </div>

          <div className="auth-switch" role="group" aria-label="Auth view">
            <button
              type="button"
              className={`auth-switch-btn${!isRegister ? " is-active" : ""}`}
              onClick={() => navigate("/login")}
              aria-pressed={!isRegister}
            >
              Sign in
            </button>
            <button
              type="button"
              className={`auth-switch-btn${isRegister ? " is-active" : ""}`}
              onClick={() => navigate("/register")}
              aria-pressed={isRegister}
            >
              Register
            </button>
          </div>

          <form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
            <h3 className="auth-heading">
              {isRegister ? "Create your account" : "Welcome back"}
            </h3>
            <p className="auth-subtitle">
              {isRegister
                ? "Join Triply and keep every thoughtful itinerary in one place."
                : "Sign in to continue planning your next adventure."}
            </p>

            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}

            <Fields mode={mode} {...formState} />

            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting
                ? isRegister
                  ? "Creating account..."
                  : "Signing in..."
                : isRegister
                  ? "Create account"
                  : "Sign in"}
            </button>

            <p className="auth-switch-link">
              {isRegister ? "Already have an account? " : "New to Triply? "}
              <button
                type="button"
                className="auth-link"
                onClick={() => navigate(isRegister ? "/login" : "/register")}
              >
                {isRegister ? "Sign in" : "Create an account"}
              </button>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
