/**
 * Determine whether an error thrown during invoice/payment tracking is
 * expected and should be silently skipped (e.g. item not yet indexed,
 * transient connectivity blip).  Unexpected errors are re-thrown by callers.
 */
export function isExpectedTrackerError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not found|does not exist|no such|temporarily unavailable|connection refused|timed out|timeout/i.test(
    message,
  );
}
