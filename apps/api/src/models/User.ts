import { model, Schema, Types, type HydratedDocument } from "mongoose";

export interface UserRecord {
  email: string;
  passwordHash: string;
  name: string;
  surname: string;
  avatarFileId: Types.ObjectId | null;
}

export type UserDocument = HydratedDocument<UserRecord>;

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  surname: string;
  avatarUrl: string | null;
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
    name: {
      type: String,
      default: "",
      trim: true,
      maxlength: 80,
    },
    surname: {
      type: String,
      default: "",
      trim: true,
      maxlength: 80,
    },
    avatarFileId: {
      type: Schema.Types.ObjectId,
      default: null,
    },
  },
  { timestamps: true },
);

export const UserModel = model<UserRecord>("User", userSchema);

export function toPublicUser(
  user: Pick<UserDocument, "_id" | "email" | "name" | "surname" | "avatarFileId">,
): PublicUser {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name ?? "",
    surname: user.surname ?? "",
    avatarUrl: user.avatarFileId ? `/api/avatars/${user.avatarFileId.toString()}` : null,
  };
}
