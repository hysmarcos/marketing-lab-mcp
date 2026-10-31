/**
 * Shared motion settings. Every animation on the page asks `motionAllowed()` first, so a visitor
 * who prefers reduced motion gets the final state at once. The same curves are mirrored in
 * tokens.css (`--ease-out`, `--ease-spring`) for the CSS side.
 */

/** Confident arrival: fast start, long settle (an exponential ease-out). */
export const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";

/** A damped spring (damping ratio 0.72, about 4% overshoot), sampled as a CSS linear() curve. */
export const EASE_SPRING =
  "linear(0, 0.031 4.2%, 0.109 8.3%, 0.214 12.5%, 0.332 16.7%, 0.451 20.8%, 0.565 25%, " +
  "0.668 29.2%, 0.757 33.3%, 0.832 37.5%, 0.893 41.7%, 0.941 45.8%, 0.977 50%, 1.003 54.2%, " +
  "1.021 58.3%, 1.031 62.5%, 1.037 66.7%, 1.038 70.8%, 1.037 75%, 1.034 79.2%, 1.03 83.3%, " +
  "1.026 87.5%, 1.021 91.7%, 1.017 95.8%, 1)";

/**
 * Delays for a staggered list: `step` ms apart, squeezed so the last one starts by `cap` ms (a
 * long list must not keep animating long after the first items have settled).
 */
export function staggerDelays(count: number, step: number, cap: number): number[] {
  const gap = count > 1 ? Math.min(step, cap / (count - 1)) : 0;
  return Array.from({ length: count }, (_, i) => Math.round(i * gap));
}

/** False when the visitor asked for reduced motion (or the page cannot tell, e.g. in tests). */
export function motionAllowed(win: Window = window): boolean {
  if (typeof win.matchMedia !== "function") return false;
  return !win.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Whether `element.animate` exists (the Web Animations API). */
export function canAnimate(element: Element): boolean {
  return typeof (element as HTMLElement).animate === "function";
}
