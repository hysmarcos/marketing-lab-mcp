import { wireCopyButton } from "./copy";

/**
 * The server URL box in the hero. With a URL it shows it and copies it; while the URL is empty
 * (the Worker is not deployed yet) it keeps the "coming soon" state with the button disabled.
 */
export function setupUrlBox(root: HTMLElement, url: string): void {
  const value = root.querySelector<HTMLElement>("[data-urlbox-value]");
  const button = root.querySelector<HTMLButtonElement>("[data-urlbox-copy]");
  const status = root.querySelector<HTMLElement>("[data-urlbox-status]");
  if (!value || !button || !status) throw new Error("The URL box markup is incomplete.");

  if (!status.id) status.id = "urlbox-status";
  if (!url) {
    root.dataset.state = "empty";
    button.disabled = true;
    // The disabled button explains itself: the status line says why and what to do instead.
    button.setAttribute("aria-describedby", status.id);
    return;
  }

  root.dataset.state = "ready";
  value.textContent = url;
  button.disabled = false;
  button.removeAttribute("aria-describedby");
  status.textContent = "Paste it into Claude as a custom connector. No account or key needed.";
  wireCopyButton(button, () => url, { status, failOnButton: false });
}
