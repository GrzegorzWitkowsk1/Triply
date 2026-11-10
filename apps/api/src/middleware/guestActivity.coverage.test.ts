import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

it("keeps every guest resource persistence boundary inside guestWrite", () => {
  // This is a security inventory: new persistence paths must opt into the fence.
  // Account-only assistant writes and migration's own transaction are explicit exceptions.
  const exceptions = new Set(["tripAssistantService.ts", "guestMigration.ts", "savedMigration.ts"]);
  const mutations = /^(?:create|save|insertOne|insertMany|updateOne|updateMany|replaceOne|findOneAndUpdate|findOneAndDelete|findByIdAndUpdate|findByIdAndDelete|deleteOne|deleteMany|bulkWrite)$/;
  const missed: string[] = [];
  for (const directory of ["../routes/", "../services/"]) {
    const folder = fileURLToPath(new URL(directory, import.meta.url));
    for (const name of readdirSync(folder)) {
      if (!name.endsWith(".ts") || name.endsWith(".test.ts") || exceptions.has(name)) continue;
      const source = ts.createSourceFile(name, readFileSync(folder + name, "utf8"), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && mutations.test(node.expression.name.text)) {
          const target = node.expression.expression.getText(source);
          const resource = /^(?:TripModel|SavedDestinationModel|SavedAttractionModel)(?:\.collection)?$/.test(target) ||
            target === "trips()" || (target === "trip" && node.expression.name.text === "save");
          if (resource) {
            let fenced = false;
            for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
              if (ts.isCallExpression(parent) && parent.expression.getText(source) === "guestWrite") fenced = true;
            }
            if (!fenced) missed.push(`${name}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  expect(missed).toEqual([]);
});
