import { zodResolver } from "@hookform/resolvers/zod";
import { VisibilityOffOutlined, VisibilityOutlined } from "@mui/icons-material";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, TextField } from "@mui/material";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { passwordSchema, type PasswordFormValues } from "../../schemas/profile";
import { changePassword } from "../../api/profile";
import { useToast } from "../ToastProvider";

export default function PasswordCard() {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isValid },
  } = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema),
    mode: "onChange",
  });

  const [showNew, setShowNew] = useState(false);
  const [showRepeat, setShowRepeat] = useState(false);
  const toast = useToast();
  const [pendingValues, setPendingValues] = useState<PasswordFormValues | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (values: PasswordFormValues) => {
    setCurrentPassword("");
    setError(null);
    setPendingValues(values);
  };
  const closeDialog = () => { if (!saving) { setPendingValues(null); setCurrentPassword(""); setError(null); } };
  const confirm = async () => {
    if (!pendingValues || !currentPassword || saving) return;
    setSaving(true); setError(null);
    try { await changePassword({ ...pendingValues, currentPassword }); setPendingValues(null); setCurrentPassword(""); reset({ newPassword: "", repeatPassword: "" }); toast("Password changed."); }
    catch (error) { const message = error instanceof Error ? error.message : "Could not change password."; setError(message); toast(message, "error"); }
    finally { setSaving(false); }
  };

  return (
    <><form className="settings-card" onSubmit={handleSubmit(onSubmit)}>
      <div className="settings-form-row">
        <TextField
          label="New password"
          required
          autoComplete="new-password"
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
          required
          autoComplete="new-password"
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
          disabled={!isValid || saving}
        >
          Change password
        </button>
      </div>
    </form>
    <Dialog open={!!pendingValues} onClose={closeDialog} fullWidth maxWidth="xs">
      <DialogTitle>Confirm password change</DialogTitle>
      <form onSubmit={event => { event.preventDefault(); void confirm(); }}>
        <DialogContent>
          <TextField label="Current password" type="password" autoComplete="current-password" required autoFocus fullWidth value={currentPassword} disabled={saving} onChange={event => setCurrentPassword(event.target.value)} />
          {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        </DialogContent>
        <DialogActions><Button onClick={closeDialog} disabled={saving}>Cancel</Button><Button type="submit" disabled={!currentPassword || saving}>Confirm</Button></DialogActions>
      </form>
    </Dialog></>
  );
}
