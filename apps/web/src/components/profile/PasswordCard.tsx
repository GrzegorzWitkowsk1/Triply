import { resolveMessage } from "../../i18n/errors";
import { errorKey as localizedErrorKey, errorMessage as localizedError } from "../../i18n/errors";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { zodResolver } from "@hookform/resolvers/zod";
import { VisibilityOffOutlined, VisibilityOutlined } from "@mui/icons-material";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, TextField } from "@mui/material";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { passwordSchema, type PasswordFormValues } from "../../schemas/profile";
import { changePassword } from "../../api/profile";
import { useToast } from "../ToastProvider";

export default function PasswordCard() {
  useTranslation();
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
    try { await changePassword({ ...pendingValues, currentPassword }); setPendingValues(null); setCurrentPassword(""); reset({ newPassword: "", repeatPassword: "" }); toast(() => i18n.t("passwordChanged", { ns: "auth/profile" })); }
    catch (error) { setError(localizedErrorKey(error)); toast(() => localizedError(error), "error"); }
    finally { setSaving(false); }
  };

  return (
    <><form className="settings-card" onSubmit={handleSubmit(onSubmit)}>
      <div className="settings-form-row">
        <TextField
          label={i18n.t("newPassword", { ns: "auth/profile" })}
          required
          autoComplete="new-password"
          fullWidth
          type={showNew ? "text" : "password"}
          error={!!errors.newPassword}
          helperText={(errors.newPassword?.message ? i18n.t(errors.newPassword?.message!) : undefined)}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    aria-label={showNew ? i18n.t("hidePassword", { ns: "auth" }) : i18n.t("showPassword", { ns: "auth" })}
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
          label={i18n.t("repeatPassword", { ns: "auth/profile" })}
          required
          autoComplete="new-password"
          fullWidth
          type={showRepeat ? "text" : "password"}
          error={!!errors.repeatPassword}
          helperText={(errors.repeatPassword?.message ? i18n.t(errors.repeatPassword?.message!) : undefined)}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    aria-label={showRepeat ? i18n.t("hidePassword", { ns: "auth" }) : i18n.t("showPassword", { ns: "auth" })}
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
          {i18n.t("changePassword", { ns: "auth/profile" })}</button>
      </div>
    </form>
    <Dialog open={!!pendingValues} onClose={closeDialog} fullWidth maxWidth="xs">
      <DialogTitle>{i18n.t("confirmPasswordChange", { ns: "auth/profile" })}</DialogTitle>
      <form onSubmit={event => { event.preventDefault(); void confirm(); }}>
        <DialogContent>
          <TextField label={i18n.t("currentPassword", { ns: "auth/profile" })} type="password" autoComplete="current-password" required autoFocus fullWidth value={currentPassword} disabled={saving} onChange={event => setCurrentPassword(event.target.value)} />
          {error && <Alert severity="error" sx={{ mt: 2 }}>{resolveMessage(error)}</Alert>}
        </DialogContent>
        <DialogActions><Button onClick={closeDialog} disabled={saving}>{i18n.t("cancel", { ns: "common" })}</Button><Button type="submit" disabled={!currentPassword || saving}>{i18n.t("confirm", { ns: "common" })}</Button></DialogActions>
      </form>
    </Dialog></>
  );
}
