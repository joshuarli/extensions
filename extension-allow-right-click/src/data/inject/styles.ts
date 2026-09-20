// custom styles
{
  const next = (): void => {
    const s = document.createElement("style");
    s.textContent = `
      .copy-protection-on #single-article-right,
      .copy-protection-on {
        pointer-events: initial !important;
      }
      ::selection {
        color: #000 !important;
        background: #accef7 !important;
      }

      @layer allow-right-click {
        ::selection {
          color: #000 !important;
          background: #accef7 !important;
        }
      }
    `;
    const parent = document.head ?? document.body;
    if (parent !== null) {
      parent.append(s);
    }
    window.pointers.run.add(() => s.remove());
  };

  if (document.body !== null) {
    next();
  } else {
    document.addEventListener("DOMContentLoaded", next);
  }
}

export {};
