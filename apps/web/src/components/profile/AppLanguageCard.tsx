import { MenuItem, Select } from "@mui/material";
import { useState } from "react";
import { LANGUAGES, type LanguageCode } from "../../config/profile";

export default function AppLanguageCard() {
  const [language, setLanguage] = useState<LanguageCode>("pl");

  return (
    <form className="settings-card">
      <Select
        id="language"
        value={language}
        onChange={(e) => setLanguage(e.target.value as LanguageCode)}
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