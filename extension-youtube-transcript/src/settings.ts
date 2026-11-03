import { Schema } from "effect";
import { PreferredLanguageSettingsSchema, type PreferredLanguageSettings } from "./types.ts";

export const preferredLanguageStorageKey = "youtube-transcript/language";

export async function readPreferredLanguageSettings(): Promise<PreferredLanguageSettings> {
  const stored = await chrome.storage.local.get({ [preferredLanguageStorageKey]: "" });
  return Schema.decodeUnknownSync(PreferredLanguageSettingsSchema)({
    language: stored[preferredLanguageStorageKey],
  });
}

export async function savePreferredLanguageSettings(
  settings: PreferredLanguageSettings,
): Promise<void> {
  await chrome.storage.local.set({ [preferredLanguageStorageKey]: settings.language });
}
