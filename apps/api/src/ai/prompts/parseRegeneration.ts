import { languageInstruction } from "./language.js";
import { REGENERATION_OPTIONS } from "@triply/shared";
import {
  nullableSchema,
  type AIRequest,
  type AISchema,
  type ParseRegenerationInput,
} from "../types.js";

export const REGENERATION_PREFERENCES_SCHEMA: AISchema = {
  type: "object",
  properties: {
    lessWalking: nullableSchema({
      type: "boolean",
      description:
        "True when the user wants to walk less or keep stops closer together. Null when not requested.",
    }),
    moreFood: nullableSchema({
      type: "boolean",
      description:
        "True when the user wants more food, markets or local experiences. Null when not requested.",
    }),
    relaxedPace: nullableSchema({
      type: "boolean",
      description:
        "True when the user wants a slower day with fewer stops and more free time. Null when not requested.",
    }),
    preferIndoor: nullableSchema({
      type: "boolean",
      description:
        "True when the user wants indoor attractions such as museums and galleries. Null when not requested.",
    }),
    surpriseMe: nullableSchema({
      type: "boolean",
      description:
        "True when the user wants something clearly different from the current day. Null when not requested.",
    }),
  },
  required: ["lessWalking", "moreFood", "relaxedPace", "preferIndoor", "surpriseMe"],
};

export function buildRegenerationSystemInstruction(): string {
  const options = REGENERATION_OPTIONS.map(
    (option) => `- ${option.id}: ${option.label} — ${option.description}`,
  ).join("\n");

  return [
    "You translate a traveller's free-form request into structured preferences for regenerating a single day of an existing trip.",
    "The planner itself builds the itinerary; you only interpret intent.",
    "",
    "Supported preferences:",
    options,
    "",
    "Rules:",
    "- Set a preference to true only when the user's request clearly asks for it, directly or through an obvious synonym.",
    "- Set a preference to null when it is not requested or you are unsure. Never guess.",
    "- Ignore anything that does not map to a supported preference (do not invent new fields).",
    "- A request may match several preferences at once.",
    "- Return only the JSON object described by the response schema.",
  ].join("\n");
}

export function buildRegenerationPrompt(input: ParseRegenerationInput): string {
  const selected = input.selectedPreferences
    ? REGENERATION_OPTIONS.filter((option) => input.selectedPreferences?.[option.id])
        .map((option) => option.label)
        .join(", ")
    : "";
  const selectedLine =
    selected.length > 0
      ? `Preferences already selected by the user: ${selected}.`
      : "The user has not selected any predefined preferences.";

  return [
    selectedLine,
    `Traveller request: ${input.customInstructions}`,
  ].join("\n\n");
}

export function buildRegenerationRequest(input: ParseRegenerationInput): AIRequest {
  return {
    systemInstruction: `${buildRegenerationSystemInstruction()}\n${languageInstruction(input.locale)}`,
    prompt: buildRegenerationPrompt(input),
    schema: REGENERATION_PREFERENCES_SCHEMA,
  };
}
