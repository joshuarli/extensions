// find the correct element
{
  const elements = new Map<HTMLElement | SVGElement, string>();
  const controllers = new Set<AbortController>();
  const tmps = new Set<HTMLImageElement>();

  const revert = (_reason: string): void => {
    for (const [e, val] of elements) {
      e.style.setProperty("pointer-events", val);
      delete e.dataset["igblock"];
    }
    elements.clear();
    for (const controller of controllers) {
      controller.abort();
    }
    controllers.clear();
    for (const img of tmps) {
      img.remove();
    }
    tmps.clear();
  };

  interface ClickPoint {
    target: EventTarget | null;
    clientX: number;
    clientY: number;
  }

  const mediaSrc = (el: Element): string | undefined => {
    if (el instanceof HTMLImageElement || el instanceof HTMLVideoElement) {
      return el.src;
    }
    return undefined;
  };

  const unblock = (e: ClickPoint): void => {
    // what if element is not clickable
    const target = e.target;
    if (target instanceof Element) {
      const root = target.parentElement ?? target;
      for (const mv of root.querySelectorAll("img,canvas,video")) {
        if (mv instanceof HTMLElement || mv instanceof SVGElement) {
          elements.set(mv, mv.style.getPropertyValue("pointer-events"));
          mv.style.setProperty("pointer-events", "all", "important");
        }
      }
    }
    const es = document.elementsFromPoint(e.clientX, e.clientY);

    const imgs = es.filter((el) => (mediaSrc(el) && !(el instanceof HTMLVideoElement)) || el instanceof HTMLCanvasElement);
    const vids = es.filter((el) => el instanceof HTMLVideoElement && el.src !== "");
    const npts = es.filter((el) => el instanceof HTMLInputElement && el.type.startsWith("text")); // INPUT[type=text], TEXTAREA

    const bgs: string[] = [];
    for (const el of es) {
      // if input is editable, detecting bg image cause wrong context to appear
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        continue;
      }

      const style = getComputedStyle(el);
      const v = style.backgroundImage;
      if (v) {
        const match = v.match(/url\(["']?(.*?)["']?\)/);
        if (match?.[1] !== undefined) {
          bgs.push(match[1]);
        }
      }
    }

    const nlfy = (el: Element): void => {
      if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) {
        return;
      }
      elements.set(el, el.style.getPropertyValue("pointer-events"));
      el.style.setProperty("pointer-events", "none");
      el.dataset["igblock"] = "true";
    };

    if (vids.length > 0) {
      // prefer video over image
      for (const el of es) {
        if (vids.includes(el) || npts.includes(el)) {
          (el as HTMLElement).focus();
          break;
        } else {
          nlfy(el);
        }
      }
    } else if (imgs.length > 0) {
      for (const el of es) {
        if (imgs.includes(el) || npts.includes(el)) {
          (el as HTMLElement).focus();
          break;
        } else {
          nlfy(el);
        }
      }
    } else if (npts.length > 0) {
      for (const el of es) {
        if (npts.includes(el)) {
          (el as HTMLElement).focus();
          break;
        } else {
          nlfy(el);
        }
      }
    } else if (bgs.length > 0) {
      const img = new Image();
      img.width = 10;
      img.height = 10;
      img.style.cssText = `
        position: fixed;
        left: ${e.clientX - 5}px;
        top: ${e.clientY - 5}px;
        opacity: 0;
        z-index: 2147483647;
      `;
      img.src = bgs[0] ?? "";
      document.body?.append(img);
      tmps.add(img);
    }
  };

  const mousedown = (e: MouseEvent): void => {
    if (e.button !== 2) {
      return;
    }
    e.stopPropagation();
    revert("before.mousedown");
    unblock(e);

    const controller = new AbortController();
    controllers.add(controller);
    document.addEventListener(
      "click",
      () => {
        revert("release.click");
      },
      {
        once: true,
        signal: controller.signal,
      },
    );
  };

  const touchstart = (e: TouchEvent): void => {
    e.stopPropagation();
    const touch = e.touches[0];
    if (touch === undefined) {
      return;
    }
    revert("before.touchstart");
    unblock({
      target: e.target,
      clientX: touch.clientX,
      clientY: touch.clientY,
    });

    const controller = new AbortController();
    controllers.add(controller);
    document.addEventListener(
      "click",
      () => {
        revert("release.click");
      },
      {
        once: true,
        signal: controller.signal,
      },
    );
  };

  document.addEventListener("mousedown", mousedown, true);
  document.addEventListener("touchstart", touchstart, true);
  window.pointers.run.add(() => {
    document.removeEventListener("mousedown", mousedown, true);
    document.removeEventListener("touchstart", touchstart, true);
  });
}

export {};
