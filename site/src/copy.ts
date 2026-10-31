export const COPIED_LABEL = "Copied";
export const COPY_FAILED = "Couldn't copy. Select the text and copy it by hand.";
export const COPY_FAILED_SHORT = "Couldn't copy";
const COPIED_MS = 2000;

/**
 * Makes `button` copy `getText()` to the clipboard. The label switches to "Copied" for two
 * seconds. If the browser refuses, `status` (when given) says what to do instead, or the
 * button says it failed.
 */
export function wireCopyButton(
  button: HTMLButtonElement,
  getText: () => string,
  status?: HTMLElement,
): void {
  const label = button.textContent ?? "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  button.addEventListener("click", async () => {
    clearTimeout(timer);
    try {
      await navigator.clipboard.writeText(getText());
      button.textContent = COPIED_LABEL;
      if (status) status.textContent = "Copied to the clipboard.";
    } catch {
      // Without a status line, the button itself says it failed; the text stays selectable.
      if (status) status.textContent = COPY_FAILED;
      button.textContent = status ? label : COPY_FAILED_SHORT;
    }
    timer = setTimeout(() => {
      button.textContent = label;
    }, COPIED_MS);
  });
}
