import type { SupportedLocale } from "@triply/shared";
export const assistantEvaluations: { id: string; messages: string[]; locale: SupportedLocale; criteria: string[] }[] = [
  { id: "A-itinerary", messages: ["What am I doing on Day 2?"], locale: "en", criteria: ["Names Retiro Park from Day 2", "Invents no venues"] },
  { id: "B-follow-up", messages: ["What am I doing on Day 2?", "How much will that day cost?"], locale: "en", criteria: ["Retains Day 2", "States that admission prices are unknown"] },
  { id: "C-missing-hours", messages: ["Is Prado Museum open at 8 PM?"], locale: "en", criteria: ["States opening hours are unavailable", "Does not assert the museum is open"] },
  { id: "D-budget", messages: ["How much budget do I have left?"], locale: "en", criteria: ["EUR 500 recorded remaining", "Distinguishes recorded expenses from incomplete estimates"] },
  { id: "E-recommendation", messages: ["Suggest something indoors if it rains."], locale: "en", criteria: ["Uses saved indoor museum classifications", "Does not invent a forecast", "Labels general suggestions"] },
  { id: "F-read-only", messages: ["Move the museum to 3 PM."], locale: "en", criteria: ["Explains read-only limitation", "Does not claim changes or offer executable confirmation"] },
  { id: "G-polish", messages: ["Co mam zaplanowane na jutro?"], locale: "pl", criteria: ["Answers in Polish", "Tomorrow is 2026-10-13 Europe/Madrid", "Uses Day 2 Retiro Park"] },
  { id: "H-long-conversation", messages: ["What is planned on Day 2?", ...Array.from({ length: 9 }, () => "Tell me more about that day, distinguishing known information from suggestions.")], locale: "en", criteria: ["All ten responses succeed", "Retains Day 2", "No duplicated or malformed history"] },
];
