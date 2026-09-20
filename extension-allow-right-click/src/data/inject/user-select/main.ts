try {
  let current: Selection["removeAllRanges"] = Selection.prototype.removeAllRanges;

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
