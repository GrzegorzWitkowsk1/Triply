import { Types } from "mongoose";
import type { NextFunction, Request, Response } from "express";
import { UserModel, toPublicUser } from "../models/User.js";
import { destroySession, getSessionUserId } from "../config/session.js";

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = getSessionUserId(req);

  if (!userId || !Types.ObjectId.isValid(userId)) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const user = await UserModel.findById(userId)
      .select("_id email name surname avatarFileId")
      .exec();

    if (!user) {
      await destroySession(req);
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    res.locals.user = toPublicUser(user);
    next();
  } catch (error) {
    next(error);
  }
}
