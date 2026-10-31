/**
 * Lets other parts of the page (the tiles in "The nine tools") open a tool in the playground. The
 * playground registers a handler once it has listed its tools; a pick made before that waits for
 * it. No runtime imports, so the initial page can use it without loading the playground.
 */

/** Selects `name` in the playground and returns its button in the tool list (if it has one). */
export type PickHandler = (name: string) => HTMLElement | undefined;

let handler: PickHandler | undefined;
const waiting: { name: string; resolve: (button: HTMLElement | undefined) => void }[] = [];

/** Whether the playground is ready to take a pick right now. */
export function pickerReady(): boolean {
  return handler !== undefined;
}

/** Opens `name` in the playground, now or as soon as it is ready. */
export function pickTool(name: string): Promise<HTMLElement | undefined> {
  if (handler) return Promise.resolve(handler(name));
  return new Promise((resolve) => waiting.push({ name, resolve }));
}

/** The playground calls this once its tools are listed. Picks made earlier are applied in order. */
export function onPickTool(next: PickHandler): void {
  handler = next;
  for (const { name, resolve } of waiting.splice(0)) resolve(next(name));
}

/** Test helper: forgets the handler and any waiting picks. */
export function resetPicker(): void {
  handler = undefined;
  waiting.length = 0;
}
