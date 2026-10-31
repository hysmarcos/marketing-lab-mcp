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
 * Makes `button` copy `getText()` to the clipboard. The label switches to "Copied" for two
 * seconds and the status line announces it; then both go back to what they said before. If the
 * browser refuses, the status line says what to do instead.
 */
export function wireCopyButton(
  button: HTMLButtonElement,
  getText: () => string,
  { status, failOnButton = !status }: CopyFeedback = {},
): void {
  const label = button.textContent ?? "";
  const statusText = status?.textContent ?? "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  button.addEventListener("click", async () => {
    clearTimeout(timer);
    try {
      await navigator.clipboard.writeText(getText());
      button.textContent = COPIED_LABEL;
      if (status) status.textContent = COPIED_STATUS;
      timer = setTimeout(() => {
        button.textContent = label;
        if (status) status.textContent = statusText;
      }, COPIED_MS);
    } catch {
      if (status) status.textContent = COPY_FAILED;
      if (failOnButton) {
        button.textContent = COPY_FAILED_SHORT;
        timer = setTimeout(() => {
          button.textContent = label;
        }, COPIED_MS);
      } else {
        // A success just before may have left "Copied" on the button; its timer was cleared.
        button.textContent = label;
      }
    }
  });
}
