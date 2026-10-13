import type { FastifyReply, FastifyRequest } from "fastify";
import { Types } from "mongoose";
import { UserModel, toPublicUser, type PublicUser } from "../models/User.js";
import { destroySession, getSessionUserId } from "../config/session.js";

declare module "fastify" { interface FastifyRequest { user: PublicUser | null; } }

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const userId = getSessionUserId(request);
  if (!userId || !Types.ObjectId.isValid(userId)) {
    await reply.code(401).send({ error: "Authentication required" });
    return;
  }
  const user = await UserModel.findById(userId).select("_id email").exec();
  if (!user) {
    await destroySession(request);
    await reply.code(401).send({ error: "Authentication required" });
    return;
  }
  request.user = toPublicUser(user);
}
export function currentUserId(request: FastifyRequest): string {
  if (!request.user) throw new Error("Authenticated user is missing");
  return request.user.id;
}
