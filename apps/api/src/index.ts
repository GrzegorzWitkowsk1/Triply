import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDb } from "./db.js";
import { healthRouter } from "./routes/health.js";

const PORT = Number(process.env.PORT ?? 4000);
const MONGODB_URI = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27018/triply";

const app = express();

app.use(cors());
app.use(express.json());

app.use(healthRouter);

connectDb(MONGODB_URI).catch((err) => {
  console.error("[db] initial connection failed:", err.message);
});

app.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
});