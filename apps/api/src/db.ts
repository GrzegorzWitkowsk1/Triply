import mongoose from "mongoose";

export async function connectDb(uri: string): Promise<void> {
  mongoose.connection.on("error", (err) => {
    console.error("[db] connection error:", err.message);
  });
  mongoose.connection.on("disconnected", () => {
    console.warn("[db] disconnected");
  });

  await mongoose.connect(uri);
  console.log("[db] connected");
}

export function isDbConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

export const READINESS_TIMEOUT_MS = 1_000;

/** One cheap metadata command per probe burst; never cache a successful result. */
export function createDbReadinessCheck(): () => Promise<boolean> {
  let inFlight: Promise<boolean> | undefined;
  return async () => {
    const db = mongoose.connection.db;
    if (!isDbConnected() || !db) return false;
    if (inFlight) return inFlight;

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const operation = (async () => {
      // ping alone also succeeds on a standalone/secondary. Guest writes need
      // transactions, so require a writable replica-set primary with sessions.
      const hello = await db.command({ hello: 1 }, {
        readPreference: "primary", timeoutMS: READINESS_TIMEOUT_MS - 100,
        signal: controller.signal,
      });
      return isDbConnected() && mongoose.connection.db === db && hello.ok === 1 &&
        hello.isWritablePrimary === true && typeof hello.setName === "string" &&
        typeof hello.logicalSessionTimeoutMinutes === "number" && hello.readOnly !== true;
    })().catch(() => false);
    const deadline = new Promise<boolean>(resolve => {
      timer = setTimeout(() => { resolve(false); controller.abort(); }, READINESS_TIMEOUT_MS);
    });
    const probe = Promise.race([operation, deadline]);
    inFlight = probe;
    void operation.finally(() => {
      clearTimeout(timer);
      // Keep a timed-out operation coalesced until it actually settles, even
      // if a transport ignores cancellation. Late success cannot change 503.
      if (inFlight === probe) inFlight = undefined;
    });
    return probe;
  };
}
