/**
 * A tab bar's ink: one bar that slides to the selected tab instead of each tab drawing its own
 * underline, so the eye follows the change of tab. It is a transform on a single element (no
 * layout), positioned from the selected tab's offsets; with reduced motion it jumps.
 */
export interface TabInk {
  /** Moves the ink to the tab that is selected now. */
  update(): void;
}

export function attachTabInk(tablist: HTMLElement): TabInk {
  const ink = document.createElement("span");
  ink.className = "tab-ink";
  ink.setAttribute("aria-hidden", "true");
  tablist.append(ink);

  function update(): void {
    const tab = tablist.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!tab) return;
    ink.style.setProperty("--tab-x", String(tab.offsetLeft));
    ink.style.setProperty("--tab-y", String(tab.offsetTop));
    ink.style.setProperty("--tab-w", String(tab.offsetWidth));
    ink.style.setProperty("--tab-h", String(tab.offsetHeight));
  }

  update();
  // The first position is placed, not animated; later changes slide.
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      update();
      requestAnimationFrame(() => {
        ink.dataset.ready = "";
      });
    });
  }
  if (typeof ResizeObserver === "function") new ResizeObserver(update).observe(tablist);
  document.fonts?.ready.then(update, () => {});
  return { update };
}
