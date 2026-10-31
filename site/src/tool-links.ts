import { motionAllowed } from "./motion";
import { pickerReady, pickTool } from "./picker";
import { startPlayground } from "./session";

/**
 * The tool names in "The nine tools" open that tool in the playground. Where the browser has
 * View Transitions, the name flies from its tile to its place in the playground's tool list
 * while the page moves there, so the eye can follow it. Otherwise (or with reduced motion) the
 * page scrolls there and the tool is selected. Keyboard focus lands on the selected tool.
 */

export const PICKED_NAME = "picked-tool";

type TransitionDocument = Document & {
  startViewTransition?: (update: () => Promise<void> | void) => { finished: Promise<void> };
};

async function openTool(button: HTMLElement, name: string, target: HTMLElement): Promise<void> {
  const doc = document as TransitionDocument;
  const motion = motionAllowed();

  // The shared-element flight only works when the playground can answer at once; a transition
  // that waits for a download would freeze the page meanwhile.
  if (!motion || !doc.startViewTransition || !pickerReady()) {
    startPlayground();
    target.scrollIntoView({ behavior: motion ? "smooth" : "auto", block: "start" });
    const picked = await pickTool(name);
    picked?.focus({ preventScroll: true });
    return;
  }

  button.style.viewTransitionName = PICKED_NAME;
  let picked: HTMLElement | undefined;
  const transition = doc.startViewTransition(async () => {
    button.style.viewTransitionName = "";
    picked = await pickTool(name);
    if (picked) picked.style.viewTransitionName = PICKED_NAME;
    target.scrollIntoView({ behavior: "instant", block: "start" });
  });
  try {
    await transition.finished;
  } finally {
    if (picked) picked.style.viewTransitionName = "";
  }
  picked?.focus({ preventScroll: true });
}

/** Wires every `[data-tool]` button under `root` to open its tool in the playground. */
export function wireToolLinks(root: HTMLElement, target: HTMLElement): void {
  for (const button of root.querySelectorAll<HTMLElement>("button[data-tool]")) {
    button.addEventListener("click", () => {
      const name = button.dataset.tool;
      if (!name) return;
      openTool(button, name, target).catch((error: unknown) => {
        console.error(`Could not open ${name} in the playground.`, error);
      });
    });
  }
}
