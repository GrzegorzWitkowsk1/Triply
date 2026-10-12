export type ValidationSeverity = "error" | "warning" | "info";
export type QualityDimension = "schedule" | "routing" | "openingHours" | "budget" | "relevance" | "workload" | "dataCompleteness";
export interface ItineraryIssue {
  code: string;
  severity: ValidationSeverity;
  dimension: QualityDimension;
  message: string;
  dayId?: string;
  activityId?: string;
  details?: Record<string, unknown>;
}
export interface ItineraryValidationResult { valid: boolean; issues: ItineraryIssue[] }
export interface TripQualityReport extends ItineraryValidationResult {
  /** Internal indicator, unavailable unless all feasibility dimensions have evidence. */
  score: number | null;
  dimensions: Record<QualityDimension, number | null>;
}
