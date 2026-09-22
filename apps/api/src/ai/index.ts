export interface TripIdeasInput {
  destination: string;
  days: number;
  budget?: number;
}

export async function generateTripIdeas(input: TripIdeasInput): Promise<string[]> {
  void input;
  throw new Error("AI integration is not implemented yet");
}