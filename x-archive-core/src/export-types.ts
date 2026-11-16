export interface MediaExportProgress {
  downloaded: number;
  failed: number;
  total: number;
}

export interface MediaExportResult {
  total: number;
  downloaded: number;
  failed: Array<{ filename: string; error: string }>;
  stopped: boolean;
}
