import { useCallback, useEffect, useMemo, useState } from "react";
import { PLAN_STAGES, type PlanStageStatus } from "../config/home";

export const STAGE_MS = 1400;

const IDLE = -1;
const LAST = PLAN_STAGES.length - 1;
const DONE = PLAN_STAGES.length;

export function useTripPlanning() {
  const [activeIndex, setActiveIndex] = useState(IDLE);

  useEffect(() => {
    if (activeIndex < 0 || activeIndex >= LAST) return;

    const timer = window.setTimeout(
      () => setActiveIndex(activeIndex + 1),
      STAGE_MS,
    );

    return () => window.clearTimeout(timer);
  }, [activeIndex]);

  const statuses = useMemo<PlanStageStatus[]>(
    () =>
      PLAN_STAGES.map((_, index) => {
        if (activeIndex < 0 || index > activeIndex) return "queue";
        return index === activeIndex ? "active" : "done";
      }),
    [activeIndex],
  );

  const start = useCallback(() => setActiveIndex(0), []);
  const finish = useCallback(() => setActiveIndex(DONE), []);
  const reset = useCallback(() => setActiveIndex(IDLE), []);

  const hasStarted = activeIndex >= 0;
  const isDone = activeIndex === DONE;

  return { statuses, start, finish, reset, hasStarted, isDone };
}