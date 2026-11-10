import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";

/** Four minutes leaves a minute of headroom below the non-renewable guest lease. */
export const GENERATION_DEADLINE_MS = 240_000;
export class OperationStoppedError extends Error {
  readonly expose = true;
  constructor(readonly code: "GENERATION_DEADLINE_EXCEEDED" | "REQUEST_CANCELLED", readonly status: number) {
    super(code === "REQUEST_CANCELLED" ? "Request cancelled." : "Generation took too long. Your trip details are saved; please retry.");
  }
}
export const generationContext = new AsyncLocalStorage<{ signal: AbortSignal; deadline: Date }>();
export function checkOperation(): void {
  const context = generationContext.getStore();
  context?.signal.throwIfAborted();
  if (context && context.deadline.getTime() <= Date.now()) throw new OperationStoppedError("GENERATION_DEADLINE_EXCEEDED", 504);
}
export function operationSignal(timeout: number, caller?: AbortSignal): AbortSignal {
  checkOperation();
  return AbortSignal.any([AbortSignal.timeout(timeout), ...[caller, generationContext.getStore()?.signal].filter((s): s is AbortSignal => !!s)]);
}
export async function operationDelay(ms: number): Promise<void> {
  checkOperation();
  await delay(ms, undefined, { signal: generationContext.getStore()?.signal });
  checkOperation();
}
