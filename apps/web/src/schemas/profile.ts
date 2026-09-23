import { z } from "zod";

export const profileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, "Name must be at least 3 characters")
    .regex(/^\p{L}+$/u, "Name can only contain letters"),
  surname: z
    .string()
    .trim()
    .min(3, "Surname must be at least 3 characters")
    .regex(/^\p{L}+$/u, "Surname can only contain letters"),
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Enter a valid email address"),
});

export type ProfileFormValues = z.infer<typeof profileSchema>;

export const passwordSchema = z
  .object({
    newPassword: z
      .string()
      .trim()
      .min(12, "Password must be at least 12 characters")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
      .regex(/[0-9]/, "Password must contain at least one number")
      .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character"),
    repeatPassword: z.string().trim().min(1, "Repeat your new password"),
  })
  .superRefine((data, ctx) => {
    if (
      data.newPassword !== "" &&
      data.repeatPassword !== "" &&
      data.newPassword !== data.repeatPassword
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["repeatPassword"],
        message: "Passwords do not match",
      });
    }
  });

export type PasswordFormValues = z.infer<typeof passwordSchema>;

export const preferencesSchema = z.object({});

export type PreferencesFormValues = z.infer<typeof preferencesSchema>;