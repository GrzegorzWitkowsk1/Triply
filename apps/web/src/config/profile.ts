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
