import { Schema } from "effect";
import {
  readPreferredLanguageSettings,
  savePreferredLanguageSettings,
} from "./settings.ts";
import { PreferredLanguageSettingsSchema } from "./types.ts";

export function mountYouTubeTranscriptOptions(root: ParentNode): void {
  const languageInput = required<HTMLInputElement>(root, "[data-yt-language]"),
    statusElement = required<HTMLDivElement>(root, "[data-yt-status]"),
    saveButton = required<HTMLButtonElement>(root, "[data-yt-save]");

  void load();
  saveButton.addEventListener("click", () => void saveLanguage());

  async function load(): Promise<void> {
    try {
      const settings = await readPreferredLanguageSettings();
      languageInput.value = settings.language;
    } catch {
      setStatus("Could not read the saved language preference.", true);
    }
  }

  async function saveLanguage(): Promise<void> {
    saveButton.disabled = true;
    try {
      const settings = Schema.decodeUnknownSync(PreferredLanguageSettingsSchema)({
        language: languageInput.value.trim(),
      });
      await savePreferredLanguageSettings(settings);
      setStatus("Saved.");
      setTimeout(() => setStatus(""), 1500);
    } catch (cause) {
      console.error("YouTube Transcript settings error:", cause);
      setStatus("Could not save the language preference.", true);
    } finally {
      saveButton.disabled = false;
    }
  }

  function setStatus(message: string, isError = false): void {
    statusElement.textContent = message;
    statusElement.classList.toggle("error", isError);
  }
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`YouTube Transcript options markup is missing ${selector}.`);
  return element;
}
