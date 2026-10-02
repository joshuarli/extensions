import { Schema } from "effect";

export class NoTranscriptError extends Schema.TaggedError<NoTranscriptError>()("NoTranscriptError", {
  message: Schema.String,
  videoUrl: Schema.String,
  attempted: Schema.Array(Schema.String),
  details: Schema.Record(Schema.String, Schema.Unknown),
}) {
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

    super({ message: parts.join(" "), videoUrl, attempted, details });
  }

  toClipboardText(): string {
    let text = `${this._tag}: ${this.message}`;
    if (this.stack) {
      text += `\n\nStack:\n${this.stack}`;
    }
    return text;
  }
}

export class InvalidPageError extends Schema.TaggedError<InvalidPageError>()("InvalidPageError", {
  message: Schema.String,
  url: Schema.String,
}) {
  constructor(message: string, url: string) {
    super({ message, url });
  }
}

export class TabNotAccessibleError extends Schema.TaggedError<TabNotAccessibleError>()(
  "TabNotAccessibleError",
  { message: Schema.String },
) {
  constructor(message: string) {
    super({ message });
  }
}

export class CaptionFetchError extends Schema.TaggedError<CaptionFetchError>()(
  "CaptionFetchError",
  { message: Schema.String },
) {
  constructor(message: string) {
    super({ message });
  }
}

export class PlayerDataError extends Schema.TaggedError<PlayerDataError>()("PlayerDataError", {
  message: Schema.String,
}) {
  constructor(message: string) {
    super({ message });
  }
}

export class PageReadError extends Schema.TaggedError<PageReadError>()("PageReadError", {
  message: Schema.String,
}) {
  constructor(message: string) {
    super({ message });
  }
}

export class SettingsReadError extends Schema.TaggedError<SettingsReadError>()("SettingsReadError", {
  message: Schema.String,
}) {
  constructor(message: string) {
    super({ message });
  }
}
