try {
  type AlertFn = (...args: unknown[]) => void;
  const originals: {
    removed: boolean;
    alert: AlertFn;
    mousePreventDefault: MouseEvent["preventDefault"];
    clipboardPreventDefault: ClipboardEvent["preventDefault"];
  } = {
    removed: false,
    alert: window.alert.bind(window),
    mousePreventDefault: MouseEvent.prototype.preventDefault,
    clipboardPreventDefault: ClipboardEvent.prototype.preventDefault,
  };

  // Alert
  Object.defineProperty(window, "alert", {
    get(): AlertFn {
      return (...args) => console.info("[alert is blocked]", ...args);
    },
    set(c: AlertFn) {
      originals.alert ||= c;
    },
    configurable: true,
  });

  // Unblock contextmenu and more
  Object.defineProperty(MouseEvent.prototype, "preventDefault", {
    get(): () => void {
      return () => {};
    },
    set(c: MouseEvent["preventDefault"]) {
      console.info('a try to overwrite "preventDefault"', c);
      originals.mousePreventDefault ||= c;
    },
    configurable: true,
  });
  Object.defineProperty(MouseEvent.prototype, "returnValue", {
    get(this: MouseEvent & { v?: unknown }): unknown {
      return originals.removed && "v" in this ? this.v : true;
    },
    set(this: MouseEvent & { v?: unknown }, c: unknown) {
      console.info('a try to overwrite "returnValue"', c);
      this.v = c;
    },
    configurable: true,
  });
  Object.defineProperty(ClipboardEvent.prototype, "preventDefault", {
    get(): () => void {
      return () => {};
    },
    set(c: ClipboardEvent["preventDefault"]) {
      originals.clipboardPreventDefault ||= c;
    },
    configurable: true,
  });

  document.documentElement.addEventListener("arc-remove", () => {
    originals.removed = true;
    Object.defineProperty(window, "alert", {
      get(): AlertFn {
        return originals.alert;
      },
      configurable: true,
    });
    Object.defineProperty(MouseEvent.prototype, "preventDefault", {
      get(): MouseEvent["preventDefault"] {
        return originals.mousePreventDefault;
      },
      configurable: true,
    });
    Object.defineProperty(ClipboardEvent.prototype, "preventDefault", {
      get(): ClipboardEvent["preventDefault"] {
        return originals.clipboardPreventDefault;
      },
      configurable: true,
    });
  });
} catch (error) {
  console.error("listen/main", error);
}

export {};
