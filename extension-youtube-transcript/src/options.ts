const language = document.querySelector<HTMLInputElement>("#language")!,
  statusEl = document.querySelector<HTMLDivElement>("#status")!,
  { language: savedLanguage } = await chrome.storage.local.get({ language: "" });
language.value = savedLanguage as string;

document.querySelector<HTMLButtonElement>("#save")!.addEventListener("click", async () => {
  await chrome.storage.local.set({ language: language.value.trim() });
  statusEl.textContent = "Saved.";
  setTimeout(() => {
    statusEl.textContent = "";
  }, 1500);
});
export {};
