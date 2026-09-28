import { z } from "zod";

export const PASSWORD_REQUIREMENTS_MESSAGE =
  "Use a password with at least 12 characters, including an uppercase letter, a number, and a special character.";

export const passwordSchema = z
  .string()
  .min(12, PASSWORD_REQUIREMENTS_MESSAGE)
  .max(128, PASSWORD_REQUIREMENTS_MESSAGE)
  .regex(/[A-Z]/, PASSWORD_REQUIREMENTS_MESSAGE)
  .regex(/[0-9]/, PASSWORD_REQUIREMENTS_MESSAGE)
  .regex(/[^A-Za-z0-9]/, PASSWORD_REQUIREMENTS_MESSAGE);
