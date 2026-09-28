export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png"];
export const ACCEPTED_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png"];

export const ACCEPTED_IMAGE_INPUT = [
  ...ACCEPTED_IMAGE_EXTENSIONS,
  ...ACCEPTED_IMAGE_TYPES,
].join(",");

export const MAX_IMAGE_SIZE_LABEL = `${Math.round(MAX_IMAGE_SIZE / 1024 / 1024)} MB`;

export function isAcceptedImageType(file: File): boolean {
  const type = file.type.trim().toLowerCase();

  return ACCEPTED_IMAGE_TYPES.includes(type === "image/jpg" ? "image/jpeg" : type);
}

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
