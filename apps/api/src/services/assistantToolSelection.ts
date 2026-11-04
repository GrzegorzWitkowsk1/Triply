import { z } from "zod";
import { assistantEnabledToolNames, assistantToolRequestsSchema, type AssistantToolName, type AssistantToolRequest } from "@triply/shared";
import type { AIProvider, AISchema } from "../ai/types.js";
import { AiError } from "../ai/errors.js";
import { assistantInvocation } from "./assistantProvider.js";
import { AssistantActionError, assistantToolDefinitions } from "./assistantToolRegistry.js";

export const normalizeIntent = (message: string) => message.normalize("NFKD").replace(/\p{M}/gu, "").replace(/ł/gi, "l").toLowerCase();
export const isPackingRequest = (message: string) => /\b(?:pack(?:ing|ed)?|unpack(?:ing|ed)?|equipment|backpack)\b|pakow|spak|rozpak|bagaz/.test(normalizeIntent(message));
export const isBudgetQuestion = (message: string) => /budget|money|funds|budzet|pieniedz|pieniadz|pozostal.*srodk/.test(normalizeIntent(message));
export function allowedAssistantTools(message: string, pending: readonly AssistantToolRequest[] = []): AssistantToolName[] {
  const names = new Set<AssistantToolName>();
  for (const clause of normalizeIntent(message).split(/\s+(?:and|oraz|i)\s+|;/)) {
    const expense = /expens|spen[dt]|wydatek|wydatk|obiad|lunch|dinner|kolacj|sniadan|\d\s*(?:eur|usd|pln|gbp|jpy|euro)|[€$£]/.test(clause);
    if (/\b(?:replace|swap|substitute|zamien|zastap|wymien)\b/.test(clause)) names.add("suggest_replacement");
    else if (/\b(?:move|shift|reschedule|przenies|przesun|przeloz)\b/.test(clause)) {
      if (expense) names.add("update_expense");
      else names.add(/\d{1,2}:\d{2}|\d\s*(?:am|pm)|godzin|\bo\s+\d/.test(clause) ? "reschedule_attraction" : "move_attraction");
    } else if (/\b(?:remove|delete|usun)\b/.test(clause)) names.add("remove_attraction");
    else if (/\b(?:add|record|dodaj|zapisz)\b/.test(clause)) names.add(expense ? "add_expense" : "add_existing_attraction");
    else if (/\b(?:update|change|zmien|popraw)\b/.test(clause)) {
      names.add(expense ? "update_expense" : /indoor|inside|pod dachem|wewnatrz/.test(clause) ? "suggest_replacement" : /\d{1,2}:\d{2}|\d\s*(?:am|pm)|godzin/.test(clause) ? "reschedule_attraction" : "move_attraction");
    }
  }
  return names.size ? [...names] : pending.length ? [...new Set(pending.map(request => request.tool).filter(name => assistantEnabledToolNames.includes(name)))] : [...assistantEnabledToolNames];
}

export function isActionRequest(message: string, pending = false) {
  const explicit = /\b(?:move|shift|reschedule|remove|add|delete|replace|swap|substitute|record|update|change|przenies|przesun|przeloz|usun|dodaj|zapisz|zamien|zastap|wymien|zmien)\b/.test(normalizeIntent(message));
  if (explicit) return true;
  // A pending preview is context, not authorization to turn a new question into
  // an amendment. Terse answers (IDs, times, names) still resolve clarification.
  return pending && !/^\s*(?:(?:and|also|a|i|oraz)\s+)?(?:what|how|why|when|where|which|is|are|does|do|can|could|ile|jaki|jaka|jakie|ktore|jak|czy|co|kiedy|gdzie|dlaczego|pokaz|podsumuj)\b/.test(normalizeIntent(message));
}
const envelope = z.object({ message: z.string().trim().max(12000), actions: z.array(z.unknown()).max(5) }).strict();
export async function selectAssistantTools(provider: AIProvider, input: { systemInstruction: string; prompt: string; allowedTools?: readonly AssistantToolName[]; intentRetry?: boolean; onDiagnostics?: (fields: Record<string, unknown>) => void }, signal: AbortSignal, onRetry: () => void): Promise<{ message: string; actions: AssistantToolRequest[]; native: boolean }> {
  const tools = assistantToolDefinitions().filter(tool => !input.allowedTools || input.allowedTools.includes(tool.name));
  const native = await provider.supportsTools?.(signal) ?? false;
  const schema = { type: "object", properties: { message: { type: "string" }, actions: { type: "array", items: { anyOf: tools.map(tool => ({ type: "object", properties: { tool: { type: "string", const: tool.name }, arguments: tool.parameters }, required: ["tool", "arguments"], additionalProperties: false })) }, maxItems: 5 } }, required: ["message", "actions"], additionalProperties: false };
  if (input.prompt.length + input.systemInstruction.length + JSON.stringify(schema).length > 60000) throw new RangeError("Assistant action context exceeds budget");
  const systemInstruction = `${input.systemInstruction}\n\n${native ? "Use declared native tool calls only for proposals. Return text for questions or clarification." : "Return exactly the declared JSON envelope with message and actions. For questions or clarification use actions: [] and put the answer in message. Do not return plain text outside the envelope."}`;
  const result = await assistantInvocation(provider, { ...input, systemInstruction, schema: schema as unknown as AISchema,
    ...(native ? { tools, responseFormat: "text" as const } : {}) }, signal, onRetry);
  try {
    const validate = (actions: unknown[]): AssistantToolRequest[] => {
      if (actions.some(action => action && typeof action === "object" && "tool" in action && !assistantEnabledToolNames.includes(action.tool as AssistantToolName))) throw new AiError("Unsupported assistant tool", 502, { code: "invalid_response" });
      if (actions.some(action => action && typeof action === "object" && "tool" in action && !tools.some(tool => tool.name === action.tool))) throw new AssistantActionError("TOOL_INTENT_MISMATCH", "Selected tool does not match the requested change.");
      return assistantToolRequestsSchema.parse(actions) as AssistantToolRequest[];
    };
    if (native && typeof result === "string" && result.trim() && result.length <= 12000) return { message: result.trim(), actions: [], native };
    if (result && typeof result === "object" && "toolCalls" in result) {
      const normalized = z.object({ toolCalls: z.array(z.object({ name: z.string(), arguments: z.unknown() }).strict()).min(1).max(5) }).strict().parse(result);
      return { message: "", actions: validate(normalized.toolCalls.map(call => ({ tool: call.name, arguments: call.arguments }))), native };
    }
    const parsed = envelope.parse(result);
    if (!parsed.actions.length && !parsed.message) throw new Error("Empty response");
    return { message: parsed.message, actions: parsed.actions.length ? validate(parsed.actions) : [], native };
  } catch (error) {
    if (error instanceof AssistantActionError && error.code === "TOOL_INTENT_MISMATCH" && !input.intentRetry) {
      onRetry();
      return selectAssistantTools(provider, { ...input, intentRetry: true, systemInstruction: `${input.systemInstruction}\nThe previous selection used an unrelated operation. Re-read the current message and use only these allowed tools: ${tools.map(tool => tool.name).join(", ")}. Never reuse arguments from an unrelated domain.` }, signal, onRetry);
    }
    if (error instanceof AssistantActionError) throw error;
    throw new AiError("Invalid assistant tool selection", 502, { code: "invalid_response" });
  }
}
