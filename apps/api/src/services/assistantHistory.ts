import type { AssistantMessage } from "@triply/shared";

/** Explicit projection is essential: Mongoose subdocument spread includes its parent. */
export function publicMessages(messages: readonly AssistantMessage[]): AssistantMessage[] {
  return messages.map(({ id, role, text, failed, proposalId }) => ({ id, role, text, ...(failed ? { failed: true } : {}), ...(proposalId ? { proposalId } : {}) }));
}
export function assistantHistory(messages: readonly AssistantMessage[], maxCharacters = 16000) {
  const pairs: { role: "user" | "assistant"; content: string }[][] = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const user = messages[i], ai = messages[i + 1];
    if (user.role !== "user" || ai.role !== "ai" || user.failed || ai.failed) continue;
    pairs.push([{ role: "user", content: user.text }, { role: "assistant", content: ai.text }]);
    i++;
  }
  const result = [] as (typeof pairs)[number];
  let size = 0;
  for (const pair of pairs.slice(-10).reverse()) {
    const length = JSON.stringify(pair).length;
    if (size + length > maxCharacters) break;
    result.unshift(...pair); size += length;
  }
  return result;
}
