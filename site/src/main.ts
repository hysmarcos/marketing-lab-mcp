import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";

import { LIVE_URL, REPO_URL } from "./config";
import { renderConnect } from "./connect";
import { runnerUnavailable, setPlaygroundStarter } from "./session";
import { loadTranscript, mountTranscripts, renderHeroItems, TRANSCRIPT_IDS } from "./transcripts";
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

// The page's one moment of motion: the hero conversation appears message by message, 400 ms
// apart. With reduced motion everything shows at once.
const REVEAL_MS = 400;
const animate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const chat = required<HTMLOListElement>("[data-hero-chat]");

function reveal(items: HTMLElement[]): void {
  if (!animate) return;
  for (const item of items) item.dataset.reveal = "pending";
  // Two frames, so the hidden state is painted before the transition starts.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      items.forEach((item, i) => {
        setTimeout(
          () => {
            item.dataset.reveal = "shown";
          },
          150 + REVEAL_MS * i,
        );
      });
    }),
  );
}

function sectionError(root: HTMLElement, text: string): void {
  const message = document.createElement("p");
  message.className = "section__note";
  message.setAttribute("role", "alert");
  message.textContent = text;
  root.replaceChildren(message);
}

// Hero: the first recorded conversation, compact. Its JSON is a small chunk of its own.
try {
  const [first] = TRANSCRIPT_IDS;
  const transcript = await loadTranscript(first);
  const items = renderHeroItems(transcript);
  if (transcript.lang !== document.documentElement.lang) chat.lang = transcript.lang;
  chat.replaceChildren(...items);
  reveal(items);
} catch (error) {
  console.error("Could not load the hero conversation.", error);
  const item = document.createElement("li");
  item.className = "chat__item";
  item.append(
    Object.assign(document.createElement("p"), {
      className: "section__note",
      textContent: "The recorded conversation could not load. Reload the page to try again.",
    }),
  );
  chat.replaceChildren(item);
}

/** Runs `start` when `target` comes within 600 px of the screen (at once without an observer). */
function whenNear(target: Element, start: () => void): void {
  if (!("IntersectionObserver" in window)) {
    start();
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        start();
      }
    },
    { rootMargin: "600px 0px" },
  );
  observer.observe(target);
}

// Transcripts: all four conversations, loaded when the section comes near the screen.
const transcriptsRoot = required<HTMLElement>("[data-transcripts]");
whenNear(transcriptsRoot, () => {
  mountTranscripts(transcriptsRoot).catch((error: unknown) => {
    console.error("Could not load the transcripts.", error);
    sectionError(transcriptsRoot, "The transcripts could not load. Reload the page to try again.");
  });
});

// Playground: its MCP client and server load when the section comes near the screen, or when a
// transcript ticket is run (the tickets run through the playground's client).
const playground = required<HTMLElement>("[data-playground]");
let playgroundStarted = false;
function startPlayground(): void {
  if (playgroundStarted) return;
  playgroundStarted = true;
  import("./playground")
    .then(({ mountPlayground }) => mountPlayground(playground))
    .catch((error: unknown) => {
      console.error("Could not start the playground.", error);
      runnerUnavailable(error);
      sectionError(playground, "The playground could not start. Reload the page to try again.");
    });
}
setPlaygroundStarter(startPlayground);
whenNear(playground, startPlayground);
