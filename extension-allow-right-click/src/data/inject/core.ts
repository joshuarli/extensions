window.pointers ??= {
  run: new Set<() => void>(),
  cache: new Map<ArcStylableElement, ArcCachedStyle>(),
  status: "",
  record: (element: ArcStylableElement, name: ArcStyleName, value: string): void => {
    window.pointers.cache.set(element, { name, value });
  },
};

{
  const next = (): void => {
    if (window.pointers.status === "" || window.pointers.status === "removed") {
      window.pointers.status = "ready";

      void chrome.runtime.sendMessage({ method: "activate" });
    } else {
      window.pointers.status = "removed";

      void chrome.runtime.sendMessage({ method: "deactivate" });

      for (const c of window.pointers.run) {
        c();
      }
      window.pointers.run = new Set();

      document.documentElement.dispatchEvent(new Event("arc-remove"));

      for (const [e, { name, value }] of window.pointers.cache) {
        e.style.setProperty(name, value);
      }
      window.pointers.cache = new Map();
    }
  };

  next();
}

export {};
