import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { readAvatar } from "../storage/avatars.js";

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

export const avatarRouter = Router();

avatarRouter.get(
  "/:fileId",
  asyncHandler(async (req, res, next) => {
    const { fileId } = req.params;

    if (typeof fileId !== "string") {
      res.status(404).json({ error: "Image not found." });
      return;
    }

    const avatar = await readAvatar(fileId);

    if (!avatar) {
      res.status(404).json({ error: "Image not found." });
      return;
    }

    res.setHeader("Content-Type", avatar.contentType);
    res.setHeader("Content-Length", String(avatar.length));
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    avatar.stream.on("error", next);
    avatar.stream.pipe(res);
  }),
);
