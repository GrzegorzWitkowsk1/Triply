import {
  Dialog as MuiDialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@mui/material";
import { useId, type FormEvent, type ReactNode } from "react";

export interface DialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  submitLabel?: string;
  cancelLabel?: string;
  submitDisabled?: boolean;
  submitting?: boolean;
  onSubmit: () => void;
  onClose: () => void;
}

export default function Dialog({
  open,
  title,
  children,
  submitLabel = "Save",
  cancelLabel = "Cancel",
  submitDisabled = false,
  submitting = false,
  onSubmit,
  onClose,
}: DialogProps) {
  const titleId = useId();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (submitDisabled || submitting) {
      return;
    }

    onSubmit();
  };

  return (
    <MuiDialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      aria-labelledby={titleId}
      slotProps={{
        paper: { className: "dialog-paper" },
        backdrop: { className: "dialog-backdrop" },
      }}
    >
      <form className="dialog-form" onSubmit={handleSubmit}>
        <DialogTitle id={titleId} className="dialog-title">
          {title}
        </DialogTitle>

        <DialogContent className="dialog-content">{children}</DialogContent>

        <DialogActions className="dialog-footer">
          <button
            type="button"
            className="btn btn-secondary dialog-cancel"
            onClick={onClose}
            disabled={submitting}
          >
            {cancelLabel}
          </button>
          <button
            type="submit"
            className="btn btn-primary dialog-submit"
            disabled={submitDisabled || submitting}
          >
            {submitting ? "Working..." : submitLabel}
          </button>
        </DialogActions>
      </form>
    </MuiDialog>
  );
}
