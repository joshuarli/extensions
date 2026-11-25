export interface MediaExportProgress {
  downloaded: number;
  failed: number;
  skipped: number;
  total: number;
}

export interface MediaExportResult {
  total: number;
  downloaded: number;
  failed: Array<{ filename: string; error: string }>;
  skipped: Array<{ filename: string; bytes: number }>;
  downloadedDetails: Array<{ filename: string; bytes: number; sha256: string }>;
  stopped: boolean;
}
