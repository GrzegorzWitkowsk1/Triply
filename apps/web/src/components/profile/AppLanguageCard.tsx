import { MenuItem, Select } from "@mui/material";
import { useState } from "react";
import { LANGUAGES, type LanguageCode } from "../../config/profile";

export default function AppLanguageCard() {
  const [language, setLanguage] = useState<LanguageCode>(() => {
    try { return localStorage.getItem("triply.language") === "en" ? "en" : "pl"; } catch { return "pl"; }
  });

  return (
    <form className="settings-card">
      <Select
        id="language"
        value={language}
        onChange={(e) => {
          const value = e.target.value as LanguageCode;
          setLanguage(value);
          try { localStorage.setItem("triply.language", value); } catch { /* Keep the selection usable when browser storage is unavailable. */ }
        }}
        fullWidth
        renderValue={(value) => {
          const lang = LANGUAGES.find((l) => l.code === value);
          return (
            <span className="language-option">
              <img className="flag-icon" src={lang?.flag} alt="" />
              {lang?.label}
            </span>
          );
        }}
      >
        {LANGUAGES.map((lang) => (
          <MenuItem key={lang.code} value={lang.code}>
            <span className="language-option">
              <img className="flag-icon" src={lang.flag} alt="" />
              {lang.label}
            </span>
          </MenuItem>
        ))}
      </Select>
    </form>
  );
}
