import {
  CaptureErrorSchema,
  CredentialsSchema,
  captureErrorKey,
  credentialKey,
  parseUserId,
  type CaptureError,
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

export async function readCaptureError(userId: string): Promise<CaptureError | null> {
  const key = captureErrorKey(userId);
  const stored = (await chrome.storage.local.get(key))[key];
  try {
    return Schema.decodeUnknownSync(CaptureErrorSchema)(stored);
  } catch {
    return null;
  }
}
