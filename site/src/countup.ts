import { motionAllowed } from "./motion";

/**
 * Numbers that count up from zero when a result appears, so the eye catches which figures are
 * new. The text keeps its own format while it counts ("R$ 1,229,558", "+119%", "5.68%") and
 * ends on exactly the original string. With reduced motion the final text is simply there.
 */

export interface NumberParts {
  prefix: string;
  value: number;
  decimals: number;
  grouped: boolean;
  suffix: string;
}

const NUMBER = /^(.*?)(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(.*)$/s;

/** Splits the first number out of a formatted string, or undefined when there is none. */
export function numberParts(text: string): NumberParts | undefined {
  const match = NUMBER.exec(text);
  if (!match) return undefined;
  const [, prefix = "", digits = "", suffix = ""] = match;
  const value = Number(digits.replaceAll(",", ""));
  if (!Number.isFinite(value)) return undefined;
  return {
    prefix,
    value,
    decimals: digits.includes(".") ? (digits.split(".")[1]?.length ?? 0) : 0,
    grouped: digits.includes(","),
    suffix,
  };
}

/** The text at `progress` (0 to 1) of the count, in the original format. */
export function textAt(parts: NumberParts, progress: number): string {
  const formatted = (parts.value * progress).toLocaleString("en-US", {
    minimumFractionDigits: parts.decimals,
    maximumFractionDigits: parts.decimals,
    useGrouping: parts.grouped,
  });
  return `${parts.prefix}${formatted}${parts.suffix}`;
}

export const COUNT_MS = 450;
const running = new WeakMap<Element, number>();

/**
 * Counts `element`'s number up from zero over `duration` ms (ease-out), then restores the exact
 * original text. Strings without a number, zero values and reduced motion are left as they are.
 */
export function countUp(
  element: HTMLElement,
  { duration = COUNT_MS, motion = motionAllowed() }: { duration?: number; motion?: boolean } = {},
): void {
  const final = element.textContent ?? "";
  const parts = numberParts(final);
  const previous = running.get(element);
  if (previous !== undefined) cancelAnimationFrame(previous);
  running.delete(element);
  if (!motion || !parts || parts.value === 0 || typeof requestAnimationFrame !== "function") {
    element.textContent = final;
    return;
  }
  let start: number | undefined;
  const frame = (now: number) => {
    start ??= now;
    const t = Math.min(1, (now - start) / duration);
    if (t >= 1) {
      element.textContent = final;
      running.delete(element);
      return;
    }
    element.textContent = textAt(parts, 1 - (1 - t) ** 3);
    running.set(element, requestAnimationFrame(frame));
  };
  element.textContent = textAt(parts, 0);
  running.set(element, requestAnimationFrame(frame));
}
