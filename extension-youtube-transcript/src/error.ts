export class TranscriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptError";
  }

  toClipboardText(): string {
    return `${this.name}: ${this.message}\n\nStack:\n${this.stack || "(no stack)"}`;
  }
}

export class NoTranscriptError extends TranscriptError {
  public readonly videoUrl: string;
  public readonly attempted: string[];
  public readonly details: Record<string, unknown>;

  constructor(videoUrl: string, attempted: string[], details: Record<string, unknown> = {}) {
    const parts = [`No transcript found for ${videoUrl}.`];

    if (attempted.length > 0) {
      parts.push(`Attempted: ${attempted.join(", ")}.`);
    }

    if (details["language"] && details["language"] !== "") {
      parts.push(`Language preference: ${String(details["language"])}.`);
    }

    if (details["apiError"]) {
      parts.push(`InnerTube API error: ${String(details["apiError"])}.`);
    }

    if (details["cause"] instanceof Error) {
      parts.push(`Cause: ${details["cause"].message}`);
    }

    super(parts.join(" "));
    this.name = "NoTranscriptError";
    this.videoUrl = videoUrl;
    this.attempted = attempted;
    this.details = details;
    if (details["cause"] instanceof Error) {
      (this as { cause?: unknown }).cause = details["cause"];
    }
  }

  override toClipboardText(): string {
    let text = `${this.name}: ${this.message}`;
    if (this.stack) {
      text += `\n\nStack:\n${this.stack}`;
    }
    return text;
  }
}

export class InvalidPageError extends TranscriptError {
  public readonly url: string;

  constructor(message: string, url: string) {
    super(message);
    this.name = "InvalidPageError";
    this.url = url;
  }
}

export class TabNotAccessibleError extends TranscriptError {
  constructor(message: string) {
    super(message);
    this.name = "TabNotAccessibleError";
  }
}

export class CaptionFetchError extends TranscriptError {
  constructor(message: string) {
    super(message);
    this.name = "CaptionFetchError";
  }
}

export class PlayerDataError extends TranscriptError {
  constructor(message: string) {
    super(message);
    this.name = "PlayerDataError";
  }
}
