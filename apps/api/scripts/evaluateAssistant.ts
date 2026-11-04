import { assistantEvaluations } from "../src/services/assistantEvaluations.js";
import { assistantFixture } from "../src/services/assistantFixtures.js";
import { buildConversationContext } from "../src/services/assistantTripContext.js";
import { assistantHistory } from "../src/services/assistantHistory.js";
import { assistantPrompt } from "../src/ai/prompts/assistant.js";
import type { AssistantMessage } from "@triply/shared";

// Explicit opt-in only. Never included in test/build scripts or CI.
if (!process.argv.includes("--live")) {
  console.log("Optional paid evaluation: bun scripts/evaluateAssistant.ts --live [scenario ID]. Uses configured AI_PROVIDER/AI_MODEL. Human review required.");
  console.log(assistantEvaluations.map(s => ({ id: s.id, criteria: s.criteria })));
} else {
  const { createAIProvider } = await import("../src/ai/providers/factory.js");
  const { assistantCompletion } = await import("../src/services/assistantProvider.js");
  const selected = process.argv.find(arg => assistantEvaluations.some(s => s.id === arg));
  for (const scenario of assistantEvaluations.filter(s => !selected || s.id === selected)) {
    const history: AssistantMessage[] = []; let lastDay: number | null = null;
    console.log(JSON.stringify({ scenario: scenario.id, humanReviewCriteria: scenario.criteria }));
    for (const message of scenario.messages) {
      const context = buildConversationContext(assistantFixture(), { message, history, lastDay, now: new Date("2026-10-12T12:00:00Z") });
      const answer = await assistantCompletion(createAIProvider(), { systemInstruction: assistantPrompt(scenario.locale), responseFormat: "text", schema: { type: "string" }, prompt: JSON.stringify({ context, history: assistantHistory(history), message }) }, AbortSignal.timeout(40000), () => {});
      history.push({ id: crypto.randomUUID(), role: "user", text: message }, { id: crypto.randomUUID(), role: "ai", text: answer });
      lastDay = context.referents.dayIndex;
      console.log(JSON.stringify({ message, answer }));
    }
  }
}
