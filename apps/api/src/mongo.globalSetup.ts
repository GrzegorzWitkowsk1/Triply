import { MongoBinary } from "mongodb-memory-server";
import type { TestProject } from "vitest/node";

export default async function setup(project: TestProject): Promise<void> {
  // Download once in the coordinator, before parallel test files can compete
  // for the same archive. Workers may only use this completed binary.
  const binary = await MongoBinary.getPath();
  project.config.env ??= {};
  project.config.env.MONGOMS_SYSTEM_BINARY = binary;
  project.config.env.MONGOMS_RUNTIME_DOWNLOAD = "false";
}
