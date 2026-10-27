import { Schema } from "effect";

export const CaptureFailureKind = Schema.Literals(["tab-not-accessible", "capture-rejected", "invalid-payload"]);

export type CaptureFailureKind = Schema.Schema.Type<typeof CaptureFailureKind>;

export class CaptureFailedError extends Schema.TaggedError<CaptureFailedError>()("CaptureFailedError", {
  tabId: Schema.Number,
  kind: CaptureFailureKind,
  message: Schema.String,
  cause: Schema.Unknown,
}) {
  constructor(tabId: number, kind: CaptureFailureKind, message: string, cause: unknown = null) {
    super({ tabId, kind, message, cause });
  }
}

export class ArchiveBuildError extends Schema.TaggedError<ArchiveBuildError>()("ArchiveBuildError", {
  message: Schema.String,
  cause: Schema.Unknown,
}) {
  constructor(message: string, cause: unknown = null) {
    super({ message, cause });
  }
}

export const DownloadFailureKind = Schema.Literals(["too-large", "rejected"]);

export type DownloadFailureKind = Schema.Schema.Type<typeof DownloadFailureKind>;

export class DownloadFailedError extends Schema.TaggedError<DownloadFailedError>()("DownloadFailedError", {
  kind: DownloadFailureKind,
  message: Schema.String,
  cause: Schema.Unknown,
}) {
  constructor(kind: DownloadFailureKind, message: string, cause: unknown = null) {
    super({ kind, message, cause });
  }
}

export const ResourceFailureReason = Schema.Literals(["timeout", "too-large", "bad-status", "network"]);

export type ResourceFailureReason = Schema.Schema.Type<typeof ResourceFailureReason>;

export class ResourceFetchError extends Schema.TaggedError<ResourceFetchError>()("ResourceFetchError", {
  url: Schema.String,
  reason: ResourceFailureReason,
  message: Schema.String,
}) {
  constructor(url: string, reason: ResourceFailureReason, message: string) {
    super({ url, reason, message });
  }
}

export class SaveInProgressError extends Schema.TaggedError<SaveInProgressError>()(
  "SaveInProgressError",
  { tabId: Schema.Number },
) {
  constructor(tabId: number) {
    super({ tabId });
  }
}
