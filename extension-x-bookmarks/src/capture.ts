import {
  CredentialsSchema,
  credentialKey,
  decodeProfileTarget,
  parseUserId,
  profileTargetKey,
  validateProfileTarget,
  type Credentials,
  type ProfileTarget,
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


export async function readProfileTarget(userId: string): Promise<ProfileTarget | null> {
  const key = profileTargetKey(userId);
  return decodeProfileTarget((await chrome.storage.local.get(key))[key]);
}

export async function writeProfileTarget(userId: string, target: ProfileTarget): Promise<void> {
  await chrome.storage.local.set({
    [profileTargetKey(userId)]: validateProfileTarget(target),
  });
}
