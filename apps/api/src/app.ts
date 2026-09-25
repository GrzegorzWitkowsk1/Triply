import cors from "cors";
import express, { type RequestHandler } from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { createSessionMiddleware } from "./config/session.js";
import { errorHandler } from "./middleware/error.js";
import { requireAuth } from "./middleware/auth.js";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

const requireTrustedOrigin: RequestHandler = (req, res, next) => {
  if (safeMethods.has(req.method)) {
    next();
    return;
  }

  const origin = req.get("origin");

  if (origin !== env.WEB_ORIGIN) {
    res.status(403).json({ error: "Request origin is not allowed" });
    return;
  }

  next();
};

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", env.TRUST_PROXY);
  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(requireTrustedOrigin);
  app.use(express.json({ limit: "100kb" }));
  app.use(createSessionMiddleware());

  app.use(healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api", requireAuth);
  app.use(errorHandler);

  return app;
}
