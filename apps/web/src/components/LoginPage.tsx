import { useState } from "react";
import { IconButton, InputAdornment, TextField } from "@mui/material";
import {
  CheckCircle,
  LocationOnOutlined,
  VisibilityOffOutlined,
  VisibilityOutlined,
} from "@mui/icons-material";
import FlightIcon from "@mui/icons-material/Flight";

type AuthView = "login" | "register";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29A11.99 11.99 0 0 0 0 12c0 1.94.47 3.77 1.29 5.38l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  );
}

interface FormState {
  email: string;
  password: string;
  showPassword: boolean;
  setEmail: (v: string) => void;
  setPassword: (v: string) => void;
  setShowPassword: (v: boolean) => void;
}

function Fields({ email, password, showPassword, setEmail, setPassword, setShowPassword }: FormState) {
  return (
    <>
      <TextField
        label="Email address"
        fullWidth
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <TextField
        label="Password"
        fullWidth
        type={showPassword ? "text" : "password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        slotProps={{
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

export default function LoginPage() {
  const [view, setView] = useState<AuthView>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

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
            <span className="auth-brand-badge">
              <FlightIcon
                sx={{ ml: "4px", color: "#ffffff", transform: "rotate(45deg)" }}
                fontSize="small"
              />
            </span>
            <span className="auth-brand-name">Triply</span>
          </div>

          <div className="auth-switch" role="group" aria-label="Auth view">
            <button
              type="button"
              className={`auth-switch-btn${view === "login" ? " is-active" : ""}`}
              onClick={() => setView("login")}
            >
              Sign in
            </button>
            <button
              type="button"
              className={`auth-switch-btn${view === "register" ? " is-active" : ""}`}
              onClick={() => setView("register")}
            >
              Register
            </button>
          </div>

          {view === "login" ? (
            <form
              className="auth-form"
              onSubmit={(e) => {
                e.preventDefault();
              }}
            >
              <h3 className="auth-heading">Welcome back</h3>
              <p className="auth-subtitle">
                Sign in to continue planning your next adventure.
              </p>

              <button type="button" className="btn btn-google" onClick={() => {}}>
                <GoogleIcon />
                Continue with Google
              </button>

              <div className="login-divider">
                <span>or continue with email</span>
              </div>

              <Fields {...formState} />

              <button type="submit" className="btn btn-primary">
                Sign in
              </button>

              <p className="auth-switch-link">
                New to Triply?{" "}
                <button type="button" className="auth-link" onClick={() => setView("register")}>
                  Create an account
                </button>
              </p>
            </form>
          ) : (
            <form
              className="auth-form"
              onSubmit={(e) => {
                e.preventDefault();
              }}
            >
              <h3 className="auth-heading">Create your account</h3>
              <p className="auth-subtitle">
                Join Triply and keep every thoughtful itinerary in one place.
              </p>

              <button type="button" className="btn btn-google" onClick={() => {}}>
                <GoogleIcon />
                Continue with Google
              </button>

              <div className="login-divider">
                <span>or continue with email</span>
              </div>

              <Fields {...formState} />

              <button type="submit" className="btn btn-primary">
                Create account
              </button>

              <p className="auth-switch-link">
                Already have an account?{" "}
                <button type="button" className="auth-link" onClick={() => setView("login")}>
                  Sign In
                </button>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}