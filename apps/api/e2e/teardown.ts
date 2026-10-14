import { request } from "@playwright/test";

export default async function teardown(): Promise<void> {
  const control = await request.newContext({ baseURL: "http://127.0.0.1:4002", extraHTTPHeaders: {
    Authorization: `Bearer ${process.env.TRIPLY_E2E_TOKEN}`,
  } });
  try {
    const response = await control.post("/shutdown");
    if (!response.ok()) throw new Error(`E2E shutdown failed: ${response.status()}`);
  } finally { await control.dispose(); }
}
