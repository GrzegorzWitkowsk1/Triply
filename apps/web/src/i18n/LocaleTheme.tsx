import { useMemo, type PropsWithChildren } from "react";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { enUS, plPL } from "@mui/material/locale";
import { useTranslation } from "react-i18next";
import { theme } from "../theme";

/** Localizes MUI-owned controls, including pagination and alert close buttons. */
export default function LocaleTheme({ children }: PropsWithChildren) {
  const { i18n } = useTranslation();
  const localized = useMemo(() => createTheme(theme, i18n.resolvedLanguage === "pl" ? plPL : enUS), [i18n.resolvedLanguage]);
  return <ThemeProvider theme={localized}>{children}</ThemeProvider>;
}
