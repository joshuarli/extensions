import { Schema } from "effect";
import { requiredElement, setStatus } from "../../lib/extension-ui.ts";
import {
  readPreferredLanguageSettings,
  savePreferredLanguageSettings,
} from "./settings.ts";
import { PreferredLanguageSettingsSchema } from "./types.ts";

const optionsContext = "YouTube Transcript options";

export function mountYouTubeTranscriptOptions(root: ParentNode): void {
  const languageInput = requiredElement<HTMLInputElement>(
      root,
      "[data-yt-language]",
      optionsContext,
    ),
    statusElement = requiredElement<HTMLDivElement>(
      root,
      "[data-yt-status]",
      optionsContext,
    ),
    saveButton = requiredElement<HTMLButtonElement>(
      root,
      "[data-yt-save]",
      optionsContext,
    );

  void load();
  saveButton.addEventListener("click", () => void saveLanguage());

  async function load(): Promise<void> {
    try {
      const settings = await readPreferredLanguageSettings();
      languageInput.value = settings.language;
    } catch {
      setStatus(statusElement, "Could not read the saved language preference.", true);
    }
  }

  async function saveLanguage(): Promise<void> {
    saveButton.disabled = true;
    try {
      const settings = Schema.decodeUnknownSync(PreferredLanguageSettingsSchema)({
        language: languageInput.value.trim(),
      });
      await savePreferredLanguageSettings(settings);
      setStatus(statusElement, "Saved.");
      setTimeout(() => setStatus(statusElement, ""), 1500);
    } catch (cause) {
      console.error("YouTube Transcript settings error:", cause);
      setStatus(statusElement, "Could not save the language preference.", true);
    } finally {
      saveButton.disabled = false;
    }
  }
}
