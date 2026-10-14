import type { FastifyInstance, preHandlerAsyncHookHandler } from "fastify";
import argon2 from "argon2";
import { AVATAR_TYPES, MAX_AVATAR_BYTES, changePasswordSchema, profilePreferencesSchema, updateProfileNamesSchema } from "@triply/shared";
import { currentUserId, requireAuth } from "../middleware/auth.js";
import { UserModel, toPublicUser } from "../models/User.js";
import { validateAvatar } from "../services/avatar.js";
import type { HttpRoute } from "../http/types.js";

export async function registerProfileRoutes(app: FastifyInstance, authLimiter: preHandlerAsyncHookHandler): Promise<void> {
  await app.register(async profile => {
    profile.addHook("preHandler", requireAuth);
    for (const type of AVATAR_TYPES) profile.addContentTypeParser(type, { parseAs: "buffer", bodyLimit: MAX_AVATAR_BYTES }, (_req, body, done) => done(null, body));
    profile.patch<HttpRoute>("/profile", async (req, res) => {
      const parsed = updateProfileNamesSchema.safeParse(req.body);
      if (!parsed.success) return res.code(400).send({ error: parsed.error.issues[0]?.message });
      const user = await UserModel.findByIdAndUpdate(currentUserId(req), { $set: parsed.data }, { new: true }).exec();
      if (!user) return res.code(401).send({ error: "Authentication required" });
      return res.send({ user: toPublicUser(user) });
    });
    profile.put<HttpRoute>("/profile/preferences", async (req, res) => {
      const parsed = profilePreferencesSchema.safeParse(req.body);
      if (!parsed.success) return res.code(400).send({ error: "Choose valid travel preferences." });
      const user = await UserModel.findByIdAndUpdate(currentUserId(req), { $set: { preferences: parsed.data } }, { new: true }).exec();
      if (!user) return res.code(401).send({ error: "Authentication required" });
      return res.send({ user: toPublicUser(user) });
    });
    profile.put<HttpRoute>("/profile/avatar", { bodyLimit: MAX_AVATAR_BYTES }, async (req, res) => {
      const type = (req.headers["content-type"] ?? "").split(";")[0];
      if (!Buffer.isBuffer(req.body)) return res.code(400).send({ error: "Upload a JPG, JPEG, PNG or SVG image." });
      const error = validateAvatar(req.body, type);
      if (error) return res.code(400).send({ error });
      const avatar = `data:${type};base64,${req.body.toString("base64")}`;
      const user = await UserModel.findByIdAndUpdate(currentUserId(req), { $set: { avatar } }, { new: true }).exec();
      if (!user) return res.code(401).send({ error: "Authentication required" });
      return res.send({ user: toPublicUser(user) });
    });
    profile.post<HttpRoute>("/profile/password", { preHandler: authLimiter }, async (req, res) => {
      const parsed = changePasswordSchema.safeParse(req.body);
      if (!parsed.success) return res.code(400).send({ error: parsed.error.issues[0]?.message });
      const user = await UserModel.findById(currentUserId(req)).select("+passwordHash").exec();
      if (!user) return res.code(401).send({ error: "Authentication required" });
      if (!await argon2.verify(user.passwordHash, parsed.data.currentPassword)) return res.code(400).send({ error: "Current password is incorrect." });
      const passwordHash = await argon2.hash(parsed.data.newPassword, { type: argon2.argon2id });
      const updated = await UserModel.updateOne({ _id: user._id, passwordHash: user.passwordHash }, { $set: { passwordHash } });
      if (!updated.modifiedCount) return res.code(409).send({ error: "Your password changed in another session. Enter the current password and try again." });
      return res.code(204).send();
    });
  }, { prefix: "/api" });
}
