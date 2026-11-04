import { afterEach, expect, it, vi } from "vitest";
import { createGeminiProvider } from "./gemini.js";
import { createOpenRouterProvider } from "./openrouter.js";
afterEach(() => vi.unstubAllGlobals());
const request = { systemInstruction: "Trip assistant", prompt: "Day 2?", schema: { type: "string" }, responseFormat: "text" as const };
it("lets the free router select tool-capable models without relying on a concrete catalog entry", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect(await createOpenRouterProvider({ apiKey: "key", model: "openrouter/free", timeoutMs: 1000 }).supportsTools?.()).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
});
it("Gemini accepts plain conversational text, excludes thinking and omits JSON constraints", async () => {
  const fetcher = vi.fn(async () => Response.json({ candidates: [{ content: { parts: [{ thought: true, text: "private reasoning" }, { text: "Museum hours are unknown." }] } }] }));
  vi.stubGlobal("fetch", fetcher);
  expect(await createGeminiProvider({ apiKey: "key", model: "model", timeoutMs: 1000 }).generate(request)).toBe("Museum hours are unknown.");
  const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  expect(body.generationConfig).not.toHaveProperty("responseSchema"); expect(body.generationConfig.maxOutputTokens).toBe(8192);
});
it.each(["Plain reply", [{ type: "text", text: "Plain reply" }]])("OpenRouter normalizes plain replies and content parts", async content => {
  const fetcher = vi.fn(async () => Response.json({ choices: [{ message: { content } }] })); vi.stubGlobal("fetch", fetcher);
  expect(await createOpenRouterProvider({ apiKey: "key", model: "configured/model", timeoutMs: 1000 }).generate(request)).toBe("Plain reply");
  const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  expect(body.messages[0].content).toBe("Trip assistant"); expect(body.max_tokens).toBe(2048);
});
it.each([{}, { choices: [{ message: { content: { unexpected: true } } }] }])("normalizes malformed OpenRouter responses to safe adapter errors", async payload => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload)));
  await expect(createOpenRouterProvider({ apiKey: "key", model: "model", timeoutMs: 1000 }).generate(request)).rejects.toMatchObject({ code: "invalid_response" });
});

const tool = { name: "add_packing_item", description: "Prepare packing preview", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } };
it.each([true, false])("rejects truncated Gemini action responses (native=%s) even when a partial result parses", async native => {
  const parts = native ? [{ functionCall: { name: tool.name, args: { name: "Umbrella" } } }] : [{ text: JSON.stringify({ message: "", actions: [{ tool: tool.name, arguments: { name: "Umbrella" } }] }) }];
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts } }] })));
  await expect(createGeminiProvider({ apiKey: "key", model: "model", timeoutMs: 1000 }).generate({ ...request, ...(native ? { tools: [tool] } : { responseFormat: undefined }) })).rejects.toMatchObject({ code: "invalid_response" });
});
it.each([true, false])("rejects truncated OpenRouter action responses (native=%s) even when a partial result parses", async native => {
  const message = native ? { tool_calls: [{ type: "function", function: { name: tool.name, arguments: '{"name":"Umbrella"}' } }] } : { content: JSON.stringify({ message: "", actions: [{ tool: tool.name, arguments: { name: "Umbrella" } }] }) };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ finish_reason: "length", message }] })));
  await expect(createOpenRouterProvider({ apiKey: "key", model: "model", timeoutMs: 1000 }).generate({ ...request, ...(native ? { tools: [tool] } : { responseFormat: undefined }) })).rejects.toMatchObject({ code: "invalid_response" });
});
it("normalizes Gemini native function calls without parsing them as itinerary JSON", async () => {
  const fetcher = vi.fn(async () => Response.json({ candidates: [{ content: { parts: [{ thought: true, functionCall: { name: "private", args: {} } }, { functionCall: { name: tool.name, args: { name: "Umbrella" } } }] } }] }));
  vi.stubGlobal("fetch", fetcher);
  const provider = createGeminiProvider({ apiKey: "key", model: "model", timeoutMs: 1000 });
  expect(await provider.supportsTools?.()).toBe(true);
  expect(await provider.generate({ ...request, tools: [tool] })).toEqual({ toolCalls: [{ name: tool.name, arguments: { name: "Umbrella" } }] });
  const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  expect(body.tools[0].functionDeclarations[0]).toMatchObject({ name: tool.name, parametersJsonSchema: tool.parameters });
  expect(body.generationConfig).not.toHaveProperty("responseSchema");
});
it("normalizes OpenRouter native tool calls and rejects malformed arguments", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: tool.name, arguments: '{"name":"Umbrella"}' } }] } }] }))
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: tool.name, arguments: "broken json" } }] } }] }));
  vi.stubGlobal("fetch", fetcher);
  const provider = createOpenRouterProvider({ apiKey: "key", model: "configured/model", timeoutMs: 1000 });
  expect(await provider.generate({ ...request, tools: [tool] })).toEqual({ toolCalls: [{ name: tool.name, arguments: { name: "Umbrella" } }] });
  await expect(provider.generate({ ...request, tools: [tool] })).rejects.toMatchObject({ code: "invalid_response" });
  const body = JSON.parse(fetcher.mock.calls[0][1].body as string);
  expect(body.tools[0].function.parameters).toEqual(tool.parameters);
  expect(body.messages[0].content).toBe(request.systemInstruction);
});
it("uses and caches configured OpenRouter model capabilities across adapter instances", async () => {
  const model = "fixture/native-tools";
  const fetcher = vi.fn(async () => Response.json({ data: [{ id: model, supported_parameters: ["tools"] }] })); vi.stubGlobal("fetch", fetcher);
  const config = { apiKey: "key", model, timeoutMs: 1000 };
  expect(await createOpenRouterProvider(config).supportsTools?.()).toBe(true);
  expect(await createOpenRouterProvider(config).supportsTools?.()).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await createOpenRouterProvider({ ...config, model: "fixture/not-supported" }).supportsTools?.()).toBe(false);
});
