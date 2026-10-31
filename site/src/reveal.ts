import { motionAllowed } from "./motion";

/**
 * Section headings and key blocks rise into place (opacity and 16 px) the first time they scroll
 * into view, so each section arrives as a unit; blocks in a group (the tiles, the connect steps)
 * follow each other by 80 ms. Body text is never revealed line by line. Only blocks that start
 * below the screen are hidden, the reveal happens once, and with reduced motion (or without an
 * observer) nothing is hidden at all.
 */

export const REVEAL_STAGGER_MS = 80;

export function revealOnScroll(groups: HTMLElement[][], win: Window = window): void {
  if (!motionAllowed(win) || !("IntersectionObserver" in win)) return;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        (entry.target as HTMLElement).dataset.reveal = "shown";
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
  );
  for (const group of groups) {
    group.forEach((element, i) => {
      if (element.getBoundingClientRect().top < win.innerHeight) return;
      element.style.setProperty("--reveal-delay", `${i * REVEAL_STAGGER_MS}ms`);
      element.dataset.reveal = "pending";
      observer.observe(element);
    });
  }
}
