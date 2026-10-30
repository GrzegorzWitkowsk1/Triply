import { createTheme } from "@mui/material/styles";

const inputRadius = "var(--radius-control)";

export const theme = createTheme({
  palette: {
    primary: { main: "#f2664b", dark: "#d54e34", contrastText: "#1c1c1c" },
    error: { main: "#b42318" },
    success: { main: "#287d2c" },
    warning: { main: "#85421a" },
    text: { primary: "#1c1c1c", secondary: "#6b6b6b" },
    divider: "#dcdcdc",
  },
  typography: {
    fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif',
    button: { textTransform: "none", fontWeight: 600, fontSize: "0.875rem", lineHeight: 1.5 },
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          minHeight: 44, borderRadius: "var(--radius-pill)", padding: "10px 20px", gap: 8,
          "&.MuiButton-text.MuiButton-colorPrimary, &.MuiButton-outlined.MuiButton-colorPrimary": { color: "var(--color-focus)" },
          "&.MuiButton-outlined.MuiButton-colorPrimary": { borderColor: "var(--color-focus)" },
          "&.MuiButton-contained.MuiButton-colorPrimary:hover": { backgroundColor: "var(--color-primary)", filter: "brightness(.97)" },
        },
        sizeSmall: { minHeight: 36, padding: "6px 12px" },
        startIcon: { margin: 0 },
        endIcon: { margin: 0 },
      },
    },
    MuiButtonBase: {
      styleOverrides: { root: { "&.Mui-focusVisible": { outline: "3px solid var(--color-focus)", outlineOffset: 3 } } },
    },
    MuiIconButton: { styleOverrides: { root: { width: 44, height: 44 }, sizeSmall: { width: 36, height: 36 } } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: inputRadius,
          backgroundColor: "var(--color-surface)",
          "& .MuiOutlinedInput-notchedOutline": {
            borderColor: "var(--color-control-border)",
          },
          "&:hover .MuiOutlinedInput-notchedOutline": {
            borderColor: "var(--color-muted)",
          },
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
            borderColor: "var(--color-focus)",
            borderWidth: 2,
          },
          "&.Mui-error .MuiOutlinedInput-notchedOutline": { borderColor: "var(--color-destructive)" },
          "&.Mui-disabled": { backgroundColor: "var(--color-surface-muted)" },
        },
        input: { padding: "16px", fontSize: "0.9375rem", "&.MuiInputBase-inputSizeSmall": { padding: "11px 14px" } },
        multiline: { padding: 16, "& textarea": { padding: 0 } },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        outlined: {
          "&.Mui-focused": {
            color: "var(--color-focus)",
          },
        },
      },
    },
    MuiFormHelperText: { styleOverrides: { root: { fontSize: "0.8125rem", lineHeight: 1.5 } } },
    MuiDialog: { styleOverrides: { paper: { borderRadius: "var(--radius-card)", boxShadow: "var(--shadow-dialog)", margin: 16, maxWidth: "calc(100% - 32px)" } } },
    MuiDialogTitle: { styleOverrides: { root: { padding: "24px 24px 12px", fontSize: "1.25rem", fontWeight: 700, lineHeight: 1.4 } } },
    MuiDialogContent: { styleOverrides: { root: { padding: "12px 24px 24px", overflowWrap: "anywhere" } } },
    MuiDialogActions: { styleOverrides: { root: { padding: "16px 24px 24px", gap: 8, flexWrap: "wrap", "& > :not(style) ~ :not(style)": { marginLeft: 0 } } } },
    MuiTooltip: { styleOverrides: { tooltip: { fontSize: "0.8125rem", lineHeight: 1.5, borderRadius: 8 } } },
    MuiAlert: { styleOverrides: { root: { borderRadius: inputRadius, fontSize: "0.875rem", lineHeight: 1.5 }, message: { minWidth: 0, overflowWrap: "anywhere" } } },
    MuiSkeleton: { defaultProps: { animation: "pulse" }, styleOverrides: { root: { borderRadius: inputRadius } } },
  },
});
