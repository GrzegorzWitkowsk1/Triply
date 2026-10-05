import type { ErrorRequestHandler } from "express";

function getHttpStatus(error: unknown): number | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    return (error as { status: number }).status;
  }

  return undefined;
}

function isExposed(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "expose" in error &&
    (error as { expose?: unknown }).expose === true
  );
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const status = getHttpStatus(error);

  if (isExposed(error) && typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    res.status(status ?? 500).json({
      error: typeof message === "string" ? message : "Request could not be processed",
    });
    return;
  }

  if (status && status >= 400 && status < 500) {
    res.status(status).json({
      error: status === 400 ? "Invalid request body" : "Request could not be processed",
    });
    return;
  }

  console.error(
    "[api] request failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  res.status(500).json({ error: "Internal server error" });
};
