import type { RegenerationPreferences } from "@triply/shared";

export interface AISchema {
  type: string;
  nullable?: boolean;
  description?: string;
  enum?: string[];
  items?: AISchema;
  properties?: Record<string, AISchema>;
  required?: string[];
}

export function nullableSchema(schema: AISchema): AISchema {
  return { ...schema, nullable: true };
}

export interface AIRequest {
  onDiagnostics?: (fields: Record<string, unknown>) => void;
  tools?: { name: string; description: string; parameters: Record<string, unknown> }[];
  /** Conversational assistant only; generation callers retain JSON mode. */
  responseFormat?: "text";
  signal?: AbortSignal;
  systemInstruction: string;
  prompt: string;
  schema: AISchema;
}

export type AIProviderName = "gemini" | "openrouter";

export interface AnalyzeTripInput {
  locale?: import("@triply/shared").SupportedLocale;
  prompt: string;
  badges: string[];
}

export interface ParseRegenerationInput {
  locale?: import("@triply/shared").SupportedLocale;
  customInstructions: string;
  selectedPreferences?: RegenerationPreferences;
}

export interface AIProvider {
  supportsTools?: (signal?: AbortSignal) => Promise<boolean>;
  generate(request: AIRequest): Promise<unknown>;
}
