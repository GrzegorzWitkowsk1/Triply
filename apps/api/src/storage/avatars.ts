import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import mongoose, { Types } from "mongoose";
import { env } from "../config/env.js";

export const ACCEPTED_AVATAR_TYPES = ["image/jpeg", "image/png"] as const;

export type AvatarContentType = (typeof ACCEPTED_AVATAR_TYPES)[number];

export interface AvatarDownload {
  stream: Readable;
  contentType: AvatarContentType;
  length: number;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

let bucket: mongoose.mongo.GridFSBucket | null = null;

function getBucket(): mongoose.mongo.GridFSBucket {
  if (bucket) {
    return bucket;
  }

  const db = mongoose.connection.db;

  if (!db) {
    throw new Error("MongoDB connection is not established");
  }

  bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: env.AVATAR_BUCKET });

  return bucket;
}

function isAcceptedType(value: unknown): value is AvatarContentType {
  return typeof value === "string" && (ACCEPTED_AVATAR_TYPES as readonly string[]).includes(value);
}

export function sniffImageType(buffer: Buffer): AvatarContentType | null {
  if (buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return "image/png";
  }

  if (
    buffer.length >= JPEG_SIGNATURE.length &&
    buffer.subarray(0, 3).equals(JPEG_SIGNATURE)
  ) {
    return "image/jpeg";
  }

  return null;
}

export async function saveAvatar(
  bytes: Buffer,
  contentType: AvatarContentType,
  userId: string,
): Promise<Types.ObjectId> {
  const extension = contentType === "image/png" ? "png" : "jpg";
  const stream = getBucket().openUploadStream(`${userId}-${randomBytes(8).toString("hex")}.${extension}`, {
    contentType,
    metadata: { userId },
  });

  return new Promise((resolve, reject) => {
    stream.on("error", reject);
    stream.on("finish", () => {
      const file = stream.gridFSFile;

      if (!file) {
        reject(new Error("Avatar upload finished without a file record"));
        return;
      }

      resolve(file._id);
    });

    stream.end(bytes);
  });
}

export async function readAvatar(fileId: string): Promise<AvatarDownload | null> {
  if (!Types.ObjectId.isValid(fileId)) {
    return null;
  }

  const objectId = new Types.ObjectId(fileId);

  let file;

  try {
    file = await getBucket().find({ _id: objectId }).limit(1).next();
  } catch {
    return null;
  }

  if (!file || !isAcceptedType(file.contentType)) {
    return null;
  }

  return {
    stream: getBucket().openDownloadStream(objectId),
    contentType: file.contentType,
    length: file.length,
  };
}

export async function deleteAvatar(fileId: Types.ObjectId | string | null): Promise<void> {
  if (!fileId || !Types.ObjectId.isValid(fileId)) {
    return;
  }

  const objectId = typeof fileId === "string" ? new Types.ObjectId(fileId) : fileId;

  try {
    await getBucket().delete(objectId);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 27
  );
}
