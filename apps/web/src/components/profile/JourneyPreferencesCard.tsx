import { Alert, Box, Button, FormControlLabel, Switch, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useJourneyPreferences } from "../../hooks/useJourneyPreferences";

export default function JourneyPreferencesSetting() {
  const { t } = useTranslation("itinerary/expenses");
  const { query, mutation, isAccount } = useJourneyPreferences();
  if (!isAccount) return null;
  return <Box sx={{ borderTop: "1px solid var(--color-line)", marginTop: 3, paddingTop: 3 }}>
    <FormControlLabel sx={{ marginLeft: 0, "& .MuiFormControlLabel-label": { fontWeight: 600, color: "var(--color-text)" } }} label={t("settingLabel")} control={<Switch checked={query.data?.preferences.promptForExpenseAfterVisit ?? true}
      disabled={!query.data || query.isError || mutation.isPending} onChange={(_event, checked) => mutation.mutate(checked)} />}/>
    <Typography variant="body2" sx={{ color: "var(--color-muted)", marginTop: 0.5, lineHeight: 1.6 }}>{t("settingDescription")}</Typography>
    {query.isPending && <p role="status">{t("loadingPreference")}</p>}
    {mutation.isPending && <p role="status">{t("savingPreference")}</p>}
    {(query.isError || mutation.isError) && <Alert severity="error">{t("preferenceError")}<Button type="button" onClick={() => void query.refetch()}>{t("retry")}</Button></Alert>}
  </Box>;
}
