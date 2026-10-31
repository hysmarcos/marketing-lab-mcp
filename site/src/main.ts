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

// Hero: one static tool call until the transcript player (Task 15) replaces it. The tools (and
// their data) are a large chunk, so they load after the shell is wired up.
const { TOOLS } = await import("../../src/server/tools");
const example = TOOLS.find((tool) => tool.name === "ab_test_evaluate")?.examples[0];
if (!example) throw new Error("ab_test_evaluate has no example input.");
const chat = required<HTMLOListElement>("[data-hero-chat]");
const call = document.createElement("li");
call.className = "chat__item chat__item--tool";
call.append(renderTicket({ tool: "ab_test_evaluate", input: example.args }));
chat.append(call);

// The page's one moment of motion: the conversation appears message by message.
const REVEAL_MS = 400;
if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const items = [...chat.querySelectorAll<HTMLElement>(".chat__item")];
  for (const item of items) item.dataset.reveal = "pending";
  items.forEach((item, i) => {
    setTimeout(
      () => {
        item.dataset.reveal = "shown";
      },
      150 + REVEAL_MS * i,
    );
  });
}
