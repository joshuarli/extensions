{
  const skip = (e: Event): void => e.stopPropagation(),
    // Try to minimize exposure
    keydown = (e: KeyboardEvent): void => {
      const meta = e.metaKey || e.ctrlKey;

      if (meta && ["KeyC", "KeyV", "KeyP", "KeyA"].includes(e.code)) {
        e.stopPropagation();
      }
    },
    paste = (e: ClipboardEvent): void => {
      e.stopPropagation();
      // Some websites use input event to revert paste changes
      const target = e.target;
      if (target !== null) {
        target.addEventListener("input", skip, true);
        requestAnimationFrame(() => {
          target.removeEventListener("input", skip, true);
        });
      }
    };

  // Bypass all registered listeners
  document.addEventListener("dragstart", skip, true);
  document.addEventListener("selectstart", skip, true);
  document.addEventListener("keydown", keydown, true);
  document.addEventListener("copy", skip, true);
  document.addEventListener("cut", skip, true);
  document.addEventListener("paste", paste, true);
  document.addEventListener("contextmenu", skip, true);
  document.addEventListener("mousedown", skip, true);

  window.pointers.run.add(() => {
    document.removeEventListener("dragstart", skip, true);
    document.removeEventListener("selectstart", skip, true);
    document.removeEventListener("keydown", keydown, true);
    document.removeEventListener("copy", skip, true);
    document.removeEventListener("cut", skip, true);
    document.removeEventListener("paste", paste, true);
    document.removeEventListener("contextmenu", skip, true);
    document.removeEventListener("mousedown", skip, true);
  });
}

export {};
