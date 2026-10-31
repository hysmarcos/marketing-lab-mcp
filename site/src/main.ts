import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";

import { LIVE_URL, REPO_URL } from "./config";
import { renderConnect } from "./connect";
import { renderTicket } from "./ticket";
import { setupUrlBox } from "./urlbox";

function required<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing ${selector} in index.html.`);
  return node;
}

for (const link of document.querySelectorAll<HTMLAnchorElement>("[data-repo-link]")) {
  link.href = REPO_URL;
}

setupUrlBox(required<HTMLElement>("[data-urlbox]"), LIVE_URL);
required<HTMLElement>("[data-connect]").append(renderConnect(LIVE_URL, REPO_URL));

// The page's one moment of motion: the conversation appears message by message. The bubble is
// hidden before the tools chunk loads, so it does not show, vanish and fade back in.
const REVEAL_MS = 400;
const animate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const chat = required<HTMLOListElement>("[data-hero-chat]");
if (animate) {
  for (const item of chat.querySelectorAll<HTMLElement>(".chat__item")) {
    item.dataset.reveal = "pending";
  }
}

function reveal(): void {
  if (!animate) return;
  const items = [...chat.querySelectorAll<HTMLElement>(".chat__item")];
  items.forEach((item, i) => {
    setTimeout(
      () => {
        item.dataset.reveal = "shown";
      },
      150 + REVEAL_MS * i,
    );
  });
}

// Hero: one static tool call until the transcript player (Task 15) replaces it. The tools (and
// their data) are a large chunk, so they load after the shell is wired up. If that chunk fails to
// load, the user bubble is still revealed instead of staying hidden.
try {
  const { TOOLS } = await import("../../src/server/tools");
  const example = TOOLS.find((tool) => tool.name === "ab_test_evaluate")?.examples[0];
  if (!example) throw new Error("ab_test_evaluate has no example input.");
  const call = document.createElement("li");
  call.className = "chat__item chat__item--tool";
  if (animate) call.dataset.reveal = "pending";
  call.append(renderTicket({ tool: "ab_test_evaluate", input: example.args }));
  chat.append(call);
} catch (error) {
  console.error("Could not load the tools for the hero.", error);
} finally {
  reveal();
}

// Playground: its MCP client and server load when the section comes near the screen. They share
// the tools chunk with the hero, so this adds only the SDK.
const playground = required<HTMLElement>("[data-playground]");
let playgroundStarted = false;
function startPlayground(): void {
  if (playgroundStarted) return;
  playgroundStarted = true;
  import("./playground")
    .then(({ mountPlayground }) => mountPlayground(playground))
    .catch((error: unknown) => {
      console.error("Could not start the playground.", error);
      const message = document.createElement("p");
      message.className = "section__note";
      message.setAttribute("role", "alert");
      message.textContent = "The playground could not start. Reload the page to try again.";
      playground.replaceChildren(message);
    });
}
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        startPlayground();
      }
    },
    { rootMargin: "600px 0px" },
  );
  observer.observe(playground);
} else {
  startPlayground();
}
