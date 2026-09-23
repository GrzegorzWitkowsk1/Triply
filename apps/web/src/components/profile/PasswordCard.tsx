import { zodResolver } from "@hookform/resolvers/zod";
import { VisibilityOffOutlined, VisibilityOutlined } from "@mui/icons-material";
import { IconButton, InputAdornment, TextField } from "@mui/material";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { passwordSchema, type PasswordFormValues } from "../../schemas/profile";

export default function PasswordCard() {
  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema),
    mode: "onChange",
  });

  const [showNew, setShowNew] = useState(false);
  const [showRepeat, setShowRepeat] = useState(false);

  const onSubmit = (values: PasswordFormValues) => {
    void values;
  };

  return (
    <form className="settings-card" onSubmit={handleSubmit(onSubmit)}>
      <div className="settings-form-row">
        <TextField
          label="New password"
          fullWidth
          type={showNew ? "text" : "password"}
          error={!!errors.newPassword}
          helperText={errors.newPassword?.message}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    aria-label={showNew ? "Hide password" : "Show password"}
                    onClick={() => setShowNew((v) => !v)}
                    size="small"
                    edge="end"
                  >
                    {showNew ? <VisibilityOffOutlined /> : <VisibilityOutlined />}
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
          {...register("newPassword")}
        />
        <TextField
          label="Repeat password"
          fullWidth
          type={showRepeat ? "text" : "password"}
          error={!!errors.repeatPassword}
          helperText={errors.repeatPassword?.message}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    aria-label={showRepeat ? "Hide password" : "Show password"}
                    onClick={() => setShowRepeat((v) => !v)}
                    size="small"
                    edge="end"
                  >
                    {showRepeat ? <VisibilityOffOutlined /> : <VisibilityOutlined />}
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
          {...register("repeatPassword")}
        />
      </div>

      <div className="settings-footer">
        <button
          type="submit"
          className="btn btn-primary settings-submit"
          disabled={!isValid}
        >
          Change password
        </button>
      </div>
    </form>
  );
}