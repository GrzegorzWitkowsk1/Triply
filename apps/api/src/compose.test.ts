import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("publishes development MongoDB only on loopback while retaining replica-set configuration and data volume", context => {
  const result = spawnSync("docker", ["compose", "-f", "docker-compose.yml", "config", "--format", "json"], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)), encoding: "utf8", timeout: 15_000,
  });
  if (result.error && "code" in result.error && result.error.code === "ENOENT") {
    context.skip("Docker CLI unavailable; effective Compose validation requires Docker Compose");
    return;
  }
  expect(result.status, result.stderr || result.error?.message).toBe(0);
  const config = JSON.parse(result.stdout);
  expect(config.services.mongo.ports).toEqual([
    expect.objectContaining({ host_ip: "127.0.0.1", target: 27018, published: "27018", protocol: "tcp" }),
  ]);
  expect(config.services.mongo.command).toEqual(["mongod", "--replSet", "rs0", "--bind_ip_all", "--port", "27018"]);
  expect(config.services.mongo.volumes).toContainEqual(expect.objectContaining({ source: "mongo_data", target: "/data/db" }));
  expect(config.services.mongo.healthcheck.test.join(" ")).toContain("host:'127.0.0.1:27018'");
  expect(config.services.mongo.healthcheck.test.join(" ")).toContain("isWritablePrimary");
});
