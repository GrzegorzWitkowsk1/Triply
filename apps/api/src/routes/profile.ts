import argon2 from "argon2";
import { rateLimit } from "express-rate-limit";
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import {
  regenerateSession,
  saveSession,
  setSessionUserId,
} from "../config/session.js";
import { avatarUpload, requireAvatarFile } from "../middleware/upload.js";
import { UserModel, toPublicUser } from "../models/User.js";
import { passwordSchema, PASSWORD_REQUIREMENTS_MESSAGE } from "../schemas/password.js";
import { deleteAvatar, saveAvatar, sniffImageType } from "../storage/avatars.js";

const nameSchema = z
  .string()
  .trim()
  .min(3, "Name must be at least 3 characters")
  .max(80, "Name must be at most 80 characters")
  .regex(/^\p{L}+$/u, "Name can only contain letters");

const profileSchema = z.object({
  name: nameSchema,
  surname: nameSchema,
});

const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordSchema,
    repeatPassword: z.string().min(1).max(128),
  })
  .refine((data) => data.newPassword === data.repeatPassword, {
    error: "Passwords do not match",
    path: ["repeatPassword"],
  });

const WRONG_PASSWORD_MESSAGE = "Current password is incorrect.";

const profileLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: "Too many profile updates. Try again later." });
  },
});

const avatarLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: "Too many avatar uploads. Try again later." });
  },
});

const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: "Too many password changes. Try again later." });
  },
});

type AsyncHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

function asyncHandler(handler: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}

const userProjection = "_id email name surname avatarFileId";

export const profileRouter = Router();

profileRouter.get("/", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ user: res.locals.user });
});

profileRouter.put(
  "/",
  profileLimiter,
  asyncHandler(async (req, res) => {
    const result = profileSchema.safeParse(req.body);

    if (!result.success) {
      res.status(400).json({
        error: "Enter a name and surname of at least 3 letters, using letters only.",
      });
      return;
    }

    const user = await UserModel.findByIdAndUpdate(
      res.locals.user.id,
      { $set: { name: result.data.name, surname: result.data.surname } },
      { new: true },
    )
      .select(userProjection)
      .exec();

    if (!user) {
      res.status(404).json({ error: "Account not found." });
      return;
    }

    res.json({ user: toPublicUser(user) });
  }),
);

profileRouter.put(
  "/avatar",
  avatarLimiter,
  avatarUpload,
  requireAvatarFile,
  asyncHandler(async (req, res) => {
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: "Choose an image to upload as your avatar." });
      return;
    }

    const contentType = sniffImageType(file.buffer);

    if (!contentType) {
      res.status(400).json({ error: "Only JPG and PNG images are allowed." });
      return;
    }

    const previousFileId = await readAvatarFileId(res.locals.user.id);
    const fileId = await saveAvatar(file.buffer, contentType, res.locals.user.id);

    const user = await UserModel.findByIdAndUpdate(
      res.locals.user.id,
      { $set: { avatarFileId: fileId } },
      { new: true },
    )
      .select(userProjection)
      .exec();

    if (!user) {
      await deleteAvatar(fileId);
      res.status(404).json({ error: "Account not found." });
      return;
    }

    if (previousFileId) {
      await deleteAvatar(previousFileId);
    }

    res.json({ user: toPublicUser(user) });
  }),
);

profileRouter.post(
  "/password",
  passwordLimiter,
  asyncHandler(async (req, res) => {
    const result = passwordChangeSchema.safeParse(req.body);

    if (!result.success) {
      const mismatch = result.error.issues.some((issue) => issue.path[0] === "repeatPassword");

      res.status(400).json({
        error: mismatch ? "Passwords do not match" : PASSWORD_REQUIREMENTS_MESSAGE,
      });
      return;
    }

    const user = await UserModel.findById(res.locals.user.id)
      .select("+passwordHash")
      .exec();

    if (!user) {
      res.status(404).json({ error: "Account not found." });
      return;
    }

    const currentPasswordMatches = await argon2.verify(
      user.passwordHash,
      result.data.currentPassword,
    );

    if (!currentPasswordMatches) {
      res.status(400).json({ error: WRONG_PASSWORD_MESSAGE });
      return;
    }

    const passwordHash = await argon2.hash(result.data.newPassword, { type: argon2.argon2id });

    const updated = await UserModel.findByIdAndUpdate(
      user._id,
      { $set: { passwordHash } },
      { new: true },
    )
      .select("_id")
      .exec();

    if (!updated) {
      res.status(404).json({ error: "Account not found." });
      return;
    }

    await regenerateSession(req);
    setSessionUserId(req, updated._id.toString());
    await saveSession(req);

    res.status(204).send();
  }),
);

async function readAvatarFileId(userId: string) {
  const user = await UserModel.findById(userId)
    .select("avatarFileId")
    .exec();

  return user?.avatarFileId ?? null;
}
