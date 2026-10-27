export const capturePolicy = {
  imageTimeoutMs: 10_000,
  imageRetryAttempts: 1,
  imageRetryBackoffMs: 500,
  maxResourceBytes: 5_000_000,
  maxDirectDownloadBytes: 1_500_000,
  saveTitleRevertMs: 2_500,
} as const;
