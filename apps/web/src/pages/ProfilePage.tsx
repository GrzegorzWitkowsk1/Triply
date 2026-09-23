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
    title: "Profile settings",
    icon: PersonOutlineOutlined,
    body: <ProfileSettingsCard />,
  },
  {
    id: "password",
    title: "Password",
    icon: LockOutlined,
    body: <PasswordCard />,
  },
  {
    id: "preferences",
    title: "Preferences",
    icon: AutoFixHighOutlined,
    body: <PreferencesCard />,
  },
  {
    id: "application",
    title: "Application settings",
    icon: LanguageOutlined,
    body: <AppLanguageCard />,
  },
];

export default function ProfilePage() {
  return (
    <div className="settings-page">
      <div className="settings-inner">
        <h1 className="settings-page-title">Settings</h1>
        <p className="settings-page-subtitle">
          Adjust your profile, update your password, and pick your language so
          Triply feels just right for you.
        </p>

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