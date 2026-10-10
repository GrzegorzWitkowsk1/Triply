import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const apiDirectory = fileURLToPath(new URL("../../", import.meta.url));
const probe = `
  import { itineraryEditRequestSchema } from "@triply/shared";
  console.log(JSON.stringify({
    resolved: import.meta.resolve("@triply/shared"),
    acceptsRetry: itineraryEditRequestSchema.safeParse({
      operation: { type: "reroute", dayIndex: 1 }, expectedVersion: 0,
    }).success,
  }));
`;

describe("shared API contract resolution", () => {
  it.each([
    { conditions: ["--conditions=development"], expectedPath: "/src/index.ts" },
    { conditions: [], expectedPath: "/dist/index.js" },
  ])("accepts Retry using $expectedPath", ({ conditions, expectedPath }) => {
    const result = spawnSync("bun", [...conditions, "--eval", probe], {
      cwd: apiDirectory, encoding: "utf8", timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout.trim()) as { resolved: string; acceptsRetry: boolean };
    expect(output.resolved.replaceAll("\\", "/")).toContain(`/packages/shared${expectedPath}`);
    expect(output.acceptsRetry).toBe(true);
  });
});
