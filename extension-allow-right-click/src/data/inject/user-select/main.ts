try {
  const nativeRemoveAllRanges = Reflect.get(Selection.prototype, "removeAllRanges");
  if (typeof nativeRemoveAllRanges !== "function") {
    throw new TypeError("The selection range method is unavailable.");
  }
  let current: Selection["removeAllRanges"] = function (this: Selection): void {
    Reflect.apply(nativeRemoveAllRanges, this, []);
  };

  Object.defineProperty(Selection.prototype, "removeAllRanges", {
    get(): () => void {
      return () => {};
    },
    set(c: Selection["removeAllRanges"]) {
      console.info('a try to overwrite "removeAllRanges"', c);
      current ||= c;
    },
    configurable: true,
  });

  document.documentElement.addEventListener("arc-remove", () => {
    Object.defineProperty(Selection.prototype, "removeAllRanges", {
      get(): Selection["removeAllRanges"] {
        return current;
      },
      configurable: true,
    });
  });
} catch {
  // Ignore pages without Selection support
}

export {};
