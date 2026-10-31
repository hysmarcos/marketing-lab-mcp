import "./styles/how.css";

import { motionAllowed } from "./motion";

/**
 * "How it works" is plain HTML whose default (`data-motion="static"`) is the final state: every
 * lane lit, every result delivered. This module only picks how the scene moves:
 * - "scroll": CSS scroll-driven animations scrub each lane with its step (how.css);
 * - "observer": an IntersectionObserver marks the step in the middle of the screen and the lane
 *   plays on a timer;
 * - "static": reduced motion, or nothing to drive the scene with.
 */

export type HowMotion = "static" | "scroll" | "observer";

export interface HowEnvironment {
  reducedMotion: boolean;
  /** CSS scroll-driven animations with `timeline-scope` (named view timelines across siblings). */
  scrollTimelines: boolean;
  observer: boolean;
}

export function pickHowMotion(env: HowEnvironment): HowMotion {
  if (env.reducedMotion) return "static";
  if (env.scrollTimelines) return "scroll";
  if (env.observer) return "observer";
  return "static";
}

export function detectHowEnvironment(win: Window = window): HowEnvironment {
  const css = (win as Window & { CSS?: { supports?: (p: string, v: string) => boolean } }).CSS;
  const supports = (property: string, value: string) =>
    typeof css?.supports === "function" && css.supports(property, value);
  return {
    reducedMotion: !motionAllowed(win),
    scrollTimelines:
      supports("animation-timeline", "view()") && supports("timeline-scope", "--how"),
    observer: "IntersectionObserver" in win,
  };
}

/** Marks lane `step` (and the tool its message calls) as the active one; 0 clears it. */
export function setActiveStep(scene: HTMLElement, step: number): void {
  scene.dataset.active = String(step);
  for (const node of scene.querySelectorAll<HTMLElement>("[data-lane], [data-hit]")) {
    const own = Number(node.dataset.lane ?? node.dataset.hit);
    node.toggleAttribute("data-active", own === step);
  }
}

/** Sets the scene's motion mode and, for "observer", watches the steps. Returns a cleanup. */
export function setupHow(
  scene: HTMLElement,
  env: HowEnvironment = detectHowEnvironment(),
): () => void {
  const motion = pickHowMotion(env);
  scene.dataset.motion = motion;
  if (motion !== "observer") return () => {};

  // A step is active while it crosses a band around the middle of the screen.
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const step = Number((entry.target as HTMLElement).dataset.step);
        if (entry.isIntersecting) setActiveStep(scene, step);
        else if (scene.dataset.active === String(step)) setActiveStep(scene, 0);
      }
    },
    { rootMargin: "-42% 0px -42% 0px" },
  );
  for (const step of scene.querySelectorAll("[data-step]")) observer.observe(step);
  return () => observer.disconnect();
}
