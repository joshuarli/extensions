import { Schema } from "effect";
import { PreferredLanguageSettingsSchema } from "./types.ts";

const languageInput = requiredElement<HTMLInputElement>("#language"),
  statusElement = requiredElement<HTMLDivElement>("#status"),
  saveButton = requiredElement<HTMLButtonElement>("#save");

try {
  const settings = Schema.decodeUnknownSync(PreferredLanguageSettingsSchema)(
    await chrome.storage.local.get({ language: "" }),
  );
  languageInput.value = settings.language;
} catch {
  setStatus("Could not read the saved language preference.", true);
}

saveButton.addEventListener("click", () => void saveLanguage());

async function saveLanguage(): Promise<void> {
  saveButton.disabled = true;
  try {
    const settings = Schema.decodeUnknownSync(PreferredLanguageSettingsSchema)({
      language: languageInput.value.trim(),
    });
    await chrome.storage.local.set(settings);
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
  statusElement.className = isError ? "error" : "";
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Options markup is missing ${selector}.`);
  return element;
}
