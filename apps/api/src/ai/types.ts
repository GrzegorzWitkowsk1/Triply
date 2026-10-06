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
  systemInstruction: string;
  prompt: string;
  schema: AISchema;
}

export type AIProviderName = "gemini" | "openrouter";

export interface AnalyzeTripInput {
  prompt: string;
  badges: string[];
}

export interface AIProvider {
  generate(request: AIRequest): Promise<unknown>;
}
