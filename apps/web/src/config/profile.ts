export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png"];

export interface ProfileFormDefaults {
  name: string;
  surname: string;
  email: string;
}

export const PROFILE_FORM_DEFAULTS: ProfileFormDefaults = {
  name: "John",
  surname: "Doe",
  email: "",
};

export type LanguageCode = "pl" | "en";

export interface LanguageOption {
  code: LanguageCode;
  label: string;
  flag: string;
}

export const LANGUAGES: LanguageOption[] = [
  { code: "pl", label: "Polski", flag: "/flags/pl.svg" },
  { code: "en", label: "English", flag: "/flags/en.svg" },
];