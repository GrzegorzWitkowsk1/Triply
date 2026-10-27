import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import {
  AutoFixHighOutlined,
  LanguageOutlined,
  LockOutlined,
  PersonOutlineOutlined,
} from "@mui/icons-material";
import AppLanguageCard from "../components/profile/AppLanguageCard";
import PasswordCard from "../components/profile/PasswordCard";
import PreferencesCard from "../components/profile/PreferencesCard";
import ProfileSettingsCard from "../components/profile/ProfileSettingsCard";

const SECTIONS = [
  {
    id: "profile",
    get title() { return i18n.t("profileSettings", { ns: "auth/profile" }); },
    icon: PersonOutlineOutlined,
    body: <ProfileSettingsCard />,
  },
  {
    id: "password",
    get title() { return i18n.t("password", { ns: "auth" }); },
    icon: LockOutlined,
    body: <PasswordCard />,
  },
  {
    id: "preferences",
    get title() { return i18n.t("preferences", { ns: "auth/profile" }); },
    icon: AutoFixHighOutlined,
    body: <PreferencesCard />,
  },
  {
    id: "application",
    get title() { return i18n.t("applicationSettings", { ns: "auth/profile" }); },
    icon: LanguageOutlined,
    body: <AppLanguageCard />,
  },
];

export default function ProfilePage() {
  useTranslation();
  return (
    <div className="settings-page">
      <div className="settings-inner">
        <h1 className="settings-page-title">{i18n.t("settings", { ns: "auth/profile" })}</h1>
        <p className="settings-page-subtitle">
          {i18n.t("adjustYourProfileUpdateYourPasswordAndPick", { ns: "auth/profile" })}</p>

        {SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <section key={section.id} className="settings-section">
              <h2 className="settings-section-title">
                <Icon />
                {section.title}
              </h2>
              {section.body}
            </section>
          );
        })}
      </div>
    </div>
  );
}