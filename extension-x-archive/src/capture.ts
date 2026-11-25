import {
  CredentialsSchema,
  captureErrorKey,
  credentialKey,
  parseUserId,
  type Credentials,
} from "../../x-archive-core/src/capture.ts";
import { Schema } from "effect";

export * from "../../x-archive-core/src/capture.ts";

export async function currentUserId(): Promise<string | null> {
  const cookie = await chrome.cookies.get({ url: "https://x.com/", name: "twid" });
  return parseUserId(cookie?.value);
}

export async function readCredentials(userId: string): Promise<Credentials> {
  const key = credentialKey(userId);
  const stored = (await chrome.storage.local.get(key))[key];
  try {
    return Schema.decodeUnknownSync(CredentialsSchema)(stored);
  } catch {
    return { queryIds: {}, features: {} };
  }
}

export interface CaptureError {
  readonly message: string;
  readonly at: string;
}

export async function readCaptureError(userId: string): Promise<CaptureError | null> {
  const key = captureErrorKey(userId);
  const stored = (await chrome.storage.local.get(key))[key] as Partial<CaptureError> | undefined;
  if (!stored || typeof stored["message"] !== "string" || typeof stored["at"] !== "string") return null;
  return { message: stored["message"], at: stored["at"] };
}
