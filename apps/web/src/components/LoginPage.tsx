import { useState } from "react";
import { IconButton, InputAdornment, TextField } from "@mui/material";
import FlightIcon from "@mui/icons-material/Flight";
import { VisibilityOffOutlined, VisibilityOutlined } from "@mui/icons-material";

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

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  return (
		<div className="login-screen">
			<div className="login-card">
				<div className="login-logo">
					<span className="login-logo-badge">
						<FlightIcon  sx={{ml:'4px', color:'#ffffff', transform:'rotate(45deg)'}}/>
					</span>
					<h1 className="login-brand">Triply</h1>
				</div>

				<h2 className="login-title">Welcome back</h2>
				<p className="login-subtitle">
					Your next thoughtful itinerary is only a few details away.
				</p>

				<button type="button" className="btn btn-google" onClick={() => {}}>
					<GoogleIcon />
					Continue with Google
				</button>

				<div className="login-divider">
					<span>or continue with email</span>
				</div>

				<form
					className="login-form"
					onSubmit={(e) => {
						e.preventDefault();
					}}
				>
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
											aria-label={
												showPassword ? "Hide password" : "Show password"
											}
											onClick={() => setShowPassword((v) => !v)}
											size="small"
										>
											{showPassword ? <VisibilityOffOutlined /> : <VisibilityOutlined />}
										</IconButton>
									</InputAdornment>
								),
							},
						}}
					/>

					<button type="submit" className="btn btn-primary">
						Sign in
					</button>
				</form>

				<p className="login-signup">
					New to Triply? <a href="/signup">Create an account</a>
				</p>
			</div>
		</div>
	);
}