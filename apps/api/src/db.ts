import mongoose from "mongoose";

export async function connectDb(uri: string): Promise<void> {
  mongoose.connection.on("error", (err) => {
    console.error("[db] connection error:", err.message);
  });
  mongoose.connection.on("disconnected", () => {
    console.warn("[db] disconnected");
  });

  await mongoose.connect(uri);
  console.log(`[db] connected to ${uri}`);
}

export function isDbConnected(): boolean {
  return mongoose.connection.readyState === 1;
}