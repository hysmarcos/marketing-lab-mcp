import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";

import { LIVE_URL, REPO_URL } from "./config";
import { renderConnect } from "./connect";
import { setupHow } from "./how";
import { canAnimate, EASE_OUT, EASE_SPRING, motionAllowed } from "./motion";
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
setupHow(required<HTMLElement>("[data-how]"));

// The hero conversation plays after the opening print (base.css): messages arrive one by one on
// a spring, and each tool ticket feeds out like a printed receipt. With reduced motion everything
// shows at once.
const chat = required<HTMLOListElement>("[data-hero-chat]");
const HERO_START_MS = 640;
const HERO_STEP_MS = 420;

function reveal(items: HTMLElement[]): void {
  if (!motionAllowed() || !items[0] || !canAnimate(items[0])) return;
  items.forEach((item, i) => {
    const delay = HERO_START_MS + HERO_STEP_MS * i;
    const ticket = item.querySelector<HTMLElement>(".ticket");
    if (ticket) {
      feedReceipt(item, ticket, delay);
      return;
    }
    item.animate(
      [
        { opacity: 0, transform: "translateY(12px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 620, delay, easing: EASE_SPRING, fill: "backwards" },
    );
  });
}

/**
 * A receipt printer pushes paper out in short bursts: the ticket slides down out of the top edge
 * of its row in three pulls. The row clips it only while it moves; its height never changes.
 */
function feedReceipt(row: HTMLElement, ticket: HTMLElement, delay: number): void {
  row.classList.add("is-feeding");
  const feed = ticket.animate(
    [
      { transform: "translateY(-101%)", easing: EASE_OUT },
      { transform: "translateY(-58%)", offset: 0.32 },
      { transform: "translateY(-58%)", offset: 0.4, easing: EASE_OUT },
      { transform: "translateY(-18%)", offset: 0.7 },
      { transform: "translateY(-18%)", offset: 0.76, easing: EASE_OUT },
      { transform: "none" },
    ],
    { duration: 760, delay, fill: "backwards" },
  );
  const done = () => row.classList.remove("is-feeding");
  feed.finished.then(done, done);
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
