import { expect, it } from "vitest";
import { assistantEvaluations } from "./assistantEvaluations.js";
import { assistantFixture } from "./assistantFixtures.js";
import { buildConversationContext } from "./assistantTripContext.js";
import { assistantHistory } from "./assistantHistory.js";
import { assistantPrompt } from "../ai/prompts/assistant.js";
import type { AssistantMessage } from "@triply/shared";
for (const scenario of assistantEvaluations) it(`evaluation construction: ${scenario.id}`, async () => {
  const history: AssistantMessage[] = []; let lastDay: number | null = null;
  const provider = { generate: async (prompt: string) => {
    const parsed = JSON.parse(prompt);
    expect(parsed.history.every((m: { role: string }) => ["user", "assistant"].includes(m.role))).toBe(true);
    expect(prompt).not.toContain("_doc");
    return "Deterministic answer (construction test, not a model quality assessment).";
  } };
  for (const message of scenario.messages) {
    const context = buildConversationContext(assistantFixture(), { message, history, lastDay, now: new Date("2026-10-12T12:00:00Z") });
    const prompt = JSON.stringify({ context, history: assistantHistory(history), message });
    expect(assistantPrompt(scenario.locale)).toContain("READ ONLY");
    const answer = await provider.generate(prompt);
    history.push({ id: crypto.randomUUID(), role: "user", text: message }, { id: crypto.randomUUID(), role: "ai", text: answer });
    lastDay = context.referents.dayIndex;
  }
  expect(history).toHaveLength(scenario.messages.length * 2);
});
