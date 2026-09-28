import { zodResolver } from "@hookform/resolvers/zod";
import { VisibilityOffOutlined, VisibilityOutlined } from "@mui/icons-material";
import { IconButton, InputAdornment, TextField } from "@mui/material";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useChangePassword } from "../../hooks/useProfile";
import { passwordSchema, type PasswordFormValues } from "../../schemas/profile";
import Dialog from "../ui/Dialog";
import { useToast } from "../ui/Toast";
import ChangePasswordDialogContent from "./ChangePasswordDialogContent";

export default function PasswordCard() {
  const { showToast } = useToast();
  const changePasswordMutation = useChangePassword();

  const {
    register,
    handleSubmit,
    getValues,
    reset,
    formState: { errors, isValid },
  } = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema),
    mode: "onChange",
  });

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);

  const [showNew, setShowNew] = useState(false);
  const [showRepeat, setShowRepeat] = useState(false);

  const closeDialog = () => {
    setIsDialogOpen(false);
    setCurrentPassword("");
    setDialogError(null);
  };

  const onSubmit = (_values: PasswordFormValues) => {
    setDialogError(null);
    setCurrentPassword("");
    setIsDialogOpen(true);
  };

  const confirmPasswordChange = () => {
    const { newPassword, repeatPassword } = getValues();

    changePasswordMutation.mutate(
      { currentPassword, newPassword, repeatPassword },
      {
        onSuccess: () => {
          showToast("Password changed.");
          closeDialog();
          reset();
        },
        onError: (error: Error) => {
          setDialogError(
            error.message || "The password could not be changed. Try again.",
          );
        },
      },
    );
  };

  return (
    <>
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
                      {showNew ? (
                        <VisibilityOffOutlined />
                      ) : (
                        <VisibilityOutlined />
                      )}
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
                      aria-label={
                        showRepeat ? "Hide password" : "Show password"
                      }
                      onClick={() => setShowRepeat((v) => !v)}
                      size="small"
                      edge="end"
                    >
                      {showRepeat ? (
                        <VisibilityOffOutlined />
                      ) : (
                        <VisibilityOutlined />
                      )}
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

      <Dialog
        open={isDialogOpen}
        title="Change password"
        submitLabel="Change password"
        cancelLabel="Cancel"
        submitDisabled={currentPassword.length === 0}
        submitting={changePasswordMutation.isPending}
        onSubmit={confirmPasswordChange}
        onClose={closeDialog}
      >
        <ChangePasswordDialogContent
          currentPassword={currentPassword}
          onCurrentPasswordChange={setCurrentPassword}
          error={dialogError}
        />
      </Dialog>
    </>
  );
}
