import { expect, it } from "vitest";
import { TripAssistantConversationModel } from "../models/TripAssistantConversation.js";
import { assistantHistory } from "./assistantHistory.js";

it("regression: spreading persisted Mongoose history leaks internals into the next prompt", () => {
  const stored = new TripAssistantConversationModel({ messages: [
    { id: "u", role: "user", text: "Day 2?" }, { id: "a", role: "ai", text: "The museum" },
  ] });
  const history = assistantHistory(stored.messages);
  expect(() => JSON.stringify({ history })).not.toThrow();
  expect(JSON.stringify({ history })).not.toContain("_doc");
  expect(history).toEqual([{ role: "user", content: "Day 2?" }, { role: "assistant", content: "The museum" }]);
});
