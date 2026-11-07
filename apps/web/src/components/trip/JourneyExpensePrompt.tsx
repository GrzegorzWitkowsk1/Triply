import { Button, Checkbox, FormControlLabel, Paper, Snackbar, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export default function JourneyExpensePrompt({ name, onAction, onDismiss }: {
  name: string; onAction: (add: boolean, disable: boolean) => void; onDismiss: () => void;
}) {
  const { t } = useTranslation("itinerary/expenses");
  const [disable, setDisable] = useState(false);
  return <Snackbar open anchorOrigin={{ vertical: "bottom", horizontal: "center" }} onClose={onDismiss}>
    <Paper role="region" aria-label={t("promptTitle")} elevation={6} sx={{
      padding: { xs: 2, sm: 3 }, maxWidth: 480, width: "100%", borderRadius: "var(--radius-card)",
      backgroundColor: "var(--color-primary-tint)", border: "1px solid var(--color-primary-light)",
      borderTop: "4px solid var(--color-primary)", boxShadow: "var(--shadow-dialog)",
    }}>
      <Typography component="h2" variant="h6" sx={{ textAlign: "center", fontWeight: 700, color: "var(--color-accent-text)", marginBottom: 1 }}>{t("promptTitle")}</Typography>
      <Typography variant="body2" sx={{ textAlign: "center", color: "var(--color-muted)", lineHeight: 1.65 }}>{t("promptDescription", { name })}</Typography>
      <FormControlLabel sx={{ margin: 0, marginY: 2, width: "100%", justifyContent: "center", "& .MuiFormControlLabel-label": { fontSize: "0.875rem", color: "var(--color-muted)" } }}
        control={<Checkbox checked={disable} onChange={(_event, checked) => setDisable(checked)} />} label={t("dontAskAgain")} />
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
        <Button variant="contained" disableElevation sx={{ borderRadius: "var(--radius-pill)", paddingX: 3, backgroundColor: "var(--color-accent-text)", color: "var(--color-surface)", "&:hover": { backgroundColor: "var(--color-accent-text)", filter: "brightness(0.92)" } }} onClick={() => onAction(true, disable)}>{t("addExpense")}</Button>
        <Button variant="outlined" sx={{ borderRadius: "var(--radius-pill)", color: "var(--color-accent-text)", borderColor: "var(--color-accent-text)" }} onClick={() => onAction(false, disable)}>{t("notNow")}</Button>
        <Button sx={{ color: "var(--color-muted)" }} onClick={onDismiss}>{t("dismiss")}</Button>
      </Stack>
    </Paper>
  </Snackbar>;
}
