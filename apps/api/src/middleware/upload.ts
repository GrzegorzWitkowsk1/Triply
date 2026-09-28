import multer from "multer";
import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { ACCEPTED_AVATAR_TYPES } from "../storage/avatars.js";

export const AVATAR_FIELD_NAME = "avatar";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.AVATAR_MAX_BYTES,
    files: 1,
    fields: 0,
  },
  fileFilter: (_req, file, callback) => {
    if (!(ACCEPTED_AVATAR_TYPES as readonly string[]).includes(file.mimetype)) {
      callback(new UploadRejectedError("Only JPG and PNG images are allowed."));
      return;
    }

    callback(null, true);
  },
});

export class UploadRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadRejectedError";
  }
}

export const avatarUpload: RequestHandler = (req, res, next) => {
  upload.single(AVATAR_FIELD_NAME)(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof UploadRejectedError) {
      res.status(400).json({ error: error.message });
      return;
    }

    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({
          error: `Image is too large. Maximum size is ${formatMegabytes(env.AVATAR_MAX_BYTES)}.`,
        });
        return;
      }

      if (
        error.code === "LIMIT_UNEXPECTED_FILE" ||
        error.code === "LIMIT_FILE_COUNT" ||
        error.code === "LIMIT_FIELD_COUNT"
      ) {
        res.status(400).json({ error: `Send a single image in the ${AVATAR_FIELD_NAME} field.` });
        return;
      }

      res.status(400).json({ error: "The avatar could not be uploaded." });
      return;
    }

    next(error);
  });
};

export const requireAvatarFile: RequestHandler = (req, res, next) => {
  if (!req.file) {
    res.status(400).json({ error: "Choose an image to upload as your avatar." });
    return;
  }

  next();
};

function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
