export const capturePolicy = {
  fetchTimeoutMs: 10_000,
  fetchRetryAttempts: 1,
  fetchRetryBackoffMs: 500,
  maxResourceBytes: 5_000_000,
  maxDirectDownloadBytes: 1_500_000,
  saveTitleRevertMs: 2_500,
} as const;
