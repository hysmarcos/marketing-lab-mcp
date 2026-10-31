import { MAX_SUMMARY_LENGTH } from "./tool";

/** Whole number with thousands separators, without relying on the runtime's locale data. */
export function groupDigits(n: number): string {
  const grouped = Math.abs(Math.round(n))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return n < 0 ? `-${grouped}` : grouped;
}

/** BRL amount, rounded to whole reais, e.g. "R$ 1,234,567". */
export function brl(n: number): string {
  return `R$ ${groupDigits(Math.round(n))}`;
}

/**
 * Builds a summary that never exceeds `MAX_SUMMARY_LENGTH`: the head lines always stay, then as
 * many detail lines as fit (leaving room for warnings), then whole warnings that fit. The full
 * rows and warnings are always in the structured output.
 */
export function fitSummary(head: string[], details: string[], warnings: string[]): string {
  const reserve = warnings.length > 0 ? 260 : 80;
  const lines = [...head];
  let used = lines.join("\n").length;
  let shown = 0;
  for (const d of details) {
    if (used + 1 + d.length > MAX_SUMMARY_LENGTH - reserve) break;
    lines.push(d);
    used += 1 + d.length;
    shown++;
  }
  if (shown < details.length) {
    const note = `(${details.length - shown} more row(s) in the structured output.)`;
    lines.push(note);
    used += 1 + note.length;
  }
  const kept: string[] = [];
  const tail = "Warnings: ".length;
  const dropNote = 60;
  let warnUsed = used + 1 + tail;
  for (const w of warnings) {
    if (warnUsed + w.length + 1 + dropNote > MAX_SUMMARY_LENGTH) break;
    kept.push(w);
    warnUsed += w.length + 1;
  }
  if (kept.length > 0) lines.push(`Warnings: ${kept.join(" ")}`);
  const dropped = warnings.length - kept.length;
  if (dropped > 0) lines.push(`(${dropped} more warning(s) in the structured output.)`);
  const text = lines.join("\n");
  return text.length <= MAX_SUMMARY_LENGTH ? text : `${text.slice(0, MAX_SUMMARY_LENGTH - 3)}...`;
}
