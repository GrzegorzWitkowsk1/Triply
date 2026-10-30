import { useId, useState } from "react";
import { Button, Menu, MenuItem } from "@mui/material";
import { useTranslation } from "react-i18next";
import i18n, { getSelectedLanguage } from "../i18n";
import { normalizeLanguage, persistLanguage } from "../i18n/config";
export default function LanguageSwitcher({ fullWidth = false }: { fullWidth?: boolean }) {
  const { t } = useTranslation("navigation", { i18n });
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const current = getSelectedLanguage();
  const languages = ["en", "pl"].map(code => ({ code, label: t(`languageNames.${code}`) }));
  const label = languages.find(language => language.code === current)!.label;
  return <>
    <Button size="small" fullWidth={fullWidth} className="language-switcher"
      aria-label={`${t("languageControl", { language: label })} — ${current.toUpperCase()}`} aria-haspopup="menu"
      aria-controls={anchor ? id : undefined} aria-expanded={Boolean(anchor)}
      onClick={event => setAnchor(event.currentTarget)}>
      <img className="flag-icon" src={`/flags/${current}.svg`} alt="" /><span aria-hidden="true" style={{ marginLeft: 6 }}>{current.toUpperCase()}</span>
    </Button>
    <Menu id={id} anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
      {languages.map(option => <MenuItem key={option.code} role="menuitemradio"
        aria-checked={current === option.code} selected={current === option.code}
        onClick={() => {
          const language = normalizeLanguage(option.code);
          if (language) { persistLanguage(language); void i18n.changeLanguage(language); }
          setAnchor(null);
        }}>
        <span className="language-option"><img className="flag-icon" src={`/flags/${option.code}.svg`} alt="" />{option.label}</span>
      </MenuItem>)}
    </Menu>
  </>;
}
