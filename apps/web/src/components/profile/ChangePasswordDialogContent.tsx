import { IconButton, InputAdornment, TextField } from "@mui/material";
import { VisibilityOffOutlined, VisibilityOutlined } from "@mui/icons-material";
import { useState } from "react";

interface ChangePasswordDialogContentProps {
  currentPassword: string;
  onCurrentPasswordChange: (value: string) => void;
  error?: string | null;
}

export default function ChangePasswordDialogContent({
  currentPassword,
  onCurrentPasswordChange,
  error,
}: ChangePasswordDialogContentProps) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="confirm-password-content">
      <p className="confirm-password-hint">
        To continue, provide your current password
      </p>

      <TextField
        label="Current password"
        fullWidth
        type={showPassword ? "text" : "password"}
        value={currentPassword}
        onChange={(event) => onCurrentPasswordChange(event.target.value)}
        error={!!error}
        helperText={error ?? undefined}
        autoComplete="current-password"
        autoFocus
        slotProps={{
          htmlInput: { maxLength: 128 },
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((value) => !value)}
                  size="small"
                  edge="end"
                >
                  {showPassword ? <VisibilityOffOutlined /> : <VisibilityOutlined />}
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
      />
    </div>
  );
}
