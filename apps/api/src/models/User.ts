import { model, Schema, type HydratedDocument } from "mongoose";

export interface UserRecord {
  email: string;
  passwordHash: string;
}

export type UserDocument = HydratedDocument<UserRecord>;

export interface PublicUser {
  id: string;
  email: string;
}

const userSchema = new Schema<UserRecord>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
  },
  { timestamps: true },
);

export const UserModel = model<UserRecord>("User", userSchema);

export function toPublicUser(user: Pick<UserDocument, "_id" | "email">): PublicUser {
  return {
    id: user._id.toString(),
    email: user.email,
  };
}
