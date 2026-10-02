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

    const language = details["language"];
    if (typeof language === "string" && language !== "") {
      parts.push(`Language preference: ${language}.`);
    }

    const apiError = details["apiError"];
    if (apiError !== undefined && apiError !== null) {
      const formattedApiError = formatUnknownValue(apiError);
      if (formattedApiError) parts.push(`InnerTube API error: ${formattedApiError}.`);
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

function formatUnknownValue(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
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
