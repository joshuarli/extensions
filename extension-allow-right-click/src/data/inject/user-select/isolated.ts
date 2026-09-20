// User-select (sheet)
{
  const clean = (sheet: CSSStyleSheet): void => {
      try {
        const checkRule = (rule: CSSRule): void => {
          if (rule instanceof CSSStyleRule) {
            if (rule.style.getPropertyValue("user-select") !== "") {
              rule.style.setProperty("user-select", "initial");
            }
          } else if (rule instanceof CSSGroupingRule) {
            for (const inner of rule.cssRules) {
              checkRule(inner);
            }
          }
        };

        for (const rule of sheet.cssRules) {
          checkRule(rule);
        }
      } catch {
        // Ignore cross-origin stylesheets
      }
    },
    seenSheets = new WeakMap<CSSStyleSheet, boolean>(),
    check = (): void => {
      for (const sheet of document.styleSheets) {
        if (!(sheet instanceof CSSStyleSheet) || seenSheets.has(sheet)) {
          continue;
        }
        const node = sheet.ownerNode;

        if (node instanceof HTMLStyleElement || node instanceof HTMLLinkElement) {
          seenSheets.set(sheet, true);
          clean(sheet);
        }
      }
    },
    observer = new MutationObserver((ms) => {
      let update = false;
      for (const m of ms) {
        for (const node of m.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            const { target } = m;
            if (target instanceof HTMLStyleElement) {
              update = true;
            }
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (node instanceof HTMLLinkElement && node.rel === "stylesheet") {
              node.addEventListener("load", () => check());
            }
            if (node instanceof HTMLStyleElement) {
              update = true;
            }
          }
        }
      }
      if (update) {
        check();
      }
    });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
  });
  window.pointers.run.add(() => observer.disconnect());
  check();
}
// User-select (inline)
{
  const observer = new MutationObserver((ms) => {
    ms.forEach((m) => {
      const target = m.target;
      if (
        (target instanceof HTMLElement || target instanceof SVGElement) &&
        target.style.getPropertyValue("user-select") !== ""
      ) {
        window.pointers.record(target, "user-select", target.style.getPropertyValue("user-select"));

        target.style.setProperty("user-select", "initial");
      }
    });
  });
  observer.observe(document.documentElement, {
    attributes: true,
    subtree: true,
    attributeFilter: ["style"],
  });
  window.pointers.run.add(() => observer.disconnect());
  [...document.querySelectorAll("[style]")].forEach((e) => {
    if (
      (e instanceof HTMLElement || e instanceof SVGElement) &&
      e.style.getPropertyValue("user-select") !== ""
    ) {
      window.pointers.record(e, "user-select", e.style.getPropertyValue("user-select"));

      e.style.setProperty("user-select", "initial");
    }
  });
}

// Unblocked elements on mouse down event that are protected by remote stylesheets
{
  const mousedown = (e: MouseEvent): void => {
    const es = document.elementsFromPoint(e.clientX, e.clientY);
    for (const el of es) {
      const style = getComputedStyle(el);
      if (
        style.getPropertyValue("user-select") === "none" &&
        (el instanceof HTMLElement || el instanceof SVGElement)
      ) {
        el.style.setProperty("user-select", "initial");
      }
    }
  };

  document.addEventListener("mousedown", mousedown, true);
  window.pointers.run.add(() => {
    document.removeEventListener("mousedown", mousedown, true);
  });
}

export {};
