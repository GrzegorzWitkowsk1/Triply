import mongoose from "mongoose";

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface SessionCookie {
  originalMaxAge: number;
  expires: string;
  secure: boolean;
  httpOnly: boolean;
  path: string;
  sameSite: "lax";
}
export interface SessionData {
  cookie: SessionCookie;
  userId?: string;
  [key: string]: unknown;
}
interface SessionRecord {
  _id: string;
  session: string;
  expires?: Date;
  lastModified?: Date;
}
export function sessionContents(data: SessionData): string {
  const { cookie: _cookie, ...values } = data;
  return JSON.stringify(values);
}

/** Retains connect-mongo's collection, JSON representation, TTL, and lazy touch. */
export function createMongoSessionStore() {
  const collection = mongoose.connection.getClient().db().collection<SessionRecord>("sessions");
  return {
    async ready(): Promise<void> {
      await collection.createIndex({ expires: 1 }, { expireAfterSeconds: 0, background: true });
    },
    async get(id: string): Promise<SessionData | null> {
      const record = await collection.findOne({ _id: id, $or: [{ expires: { $exists: false } }, { expires: { $gt: new Date() } }] });
      return record ? JSON.parse(record.session) as SessionData : null;
    },
    async save(id: string, data: SessionData): Promise<void> {
      await collection.updateOne({ _id: id }, { $set: {
        session: JSON.stringify(data), expires: new Date(data.cookie.expires), lastModified: new Date(),
      } }, { upsert: true });
    },
    async touch(id: string, expires: Date): Promise<void> {
      await collection.updateOne({ _id: id, $or: [
        { lastModified: { $exists: false } }, { lastModified: { $lte: new Date(Date.now() - TOUCH_INTERVAL_MS) } },
      ] }, { $set: { expires, lastModified: new Date() } });
    },
    async destroy(id: string): Promise<void> { await collection.deleteOne({ _id: id }); },
  };
}
