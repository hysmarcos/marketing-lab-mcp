export const COPIED_LABEL = "Copied";
export const COPIED_STATUS = "Copied to the clipboard.";
export const COPY_FAILED = "Couldn't copy. Select the text and copy it by hand.";
export const COPY_FAILED_SHORT = "Couldn't copy";
export const COPIED_MS = 2000;

export interface CopyFeedback {
  /** Polite live region that announces the result. Its own text comes back when the label does. */
  status?: HTMLElement;
  /** Also show a failure on the button (for a status line that is visually hidden). */
  failOnButton?: boolean;
}

/**
 * Puts `text` on the button in its own span, so the new label can fade in (styles in base.css).
 * `copied` adds the check mark. The button keeps its width while the label is swapped.
 */
function setLabel(button: HTMLButtonElement, text: string, copied: boolean): void {
  const span = document.createElement("span");
  span.className = "copy-label";
  span.textContent = text;
  button.replaceChildren(span);
  button.toggleAttribute("data-copied", copied);
}

/**
 * Makes `button` copy `getText()` to the clipboard. The label switches to "Copied" for two
 * seconds and the status line announces it; then both go back to what they said before. If the
 * browser refuses, the status line says what to do instead.
 */
export function wireCopyButton(
  button: HTMLButtonElement,
  getText: () => string,
  { status, failOnButton = !status }: CopyFeedback = {},
): void {
  const label = (button.textContent ?? "").trim();
  const statusText = status?.textContent ?? "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  button.addEventListener("click", async () => {
    clearTimeout(timer);
    try {
      await navigator.clipboard.writeText(getText());
      if (button.offsetWidth > 0) button.style.minWidth = `${button.offsetWidth}px`;
      setLabel(button, COPIED_LABEL, true);
      if (status) status.textContent = COPIED_STATUS;
      timer = setTimeout(() => {
        setLabel(button, label, false);
        if (status) status.textContent = statusText;
      }, COPIED_MS);
    } catch {
      if (status) status.textContent = COPY_FAILED;
      if (failOnButton) {
        setLabel(button, COPY_FAILED_SHORT, false);
        timer = setTimeout(() => {
          setLabel(button, label, false);
        }, COPIED_MS);
      } else {
        // A success just before may have left "Copied" on the button; its timer was cleared.
        setLabel(button, label, false);
      }
    }
  });
}
