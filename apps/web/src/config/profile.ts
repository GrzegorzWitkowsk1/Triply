export { MAX_AVATAR_BYTES as MAX_IMAGE_SIZE, AVATAR_TYPES as ACCEPTED_IMAGE_TYPES } from "@triply/shared";

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
