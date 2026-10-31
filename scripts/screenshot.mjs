// Saves docs/img/demo.png: the hero after its recorded conversation has played, with the first
// tool ticket re-run in the browser and stamped "Matches recording". 1280x800 at 2x.
//
//   npx vite build && npx vite preview --port 4173
//   node scripts/screenshot.mjs [http://localhost:4173/marketing-lab-mcp/]
//
// Uses the installed Microsoft Edge by default (no browser download); set PW_CHANNEL=chrome to
// use Chrome instead.
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:4173/marketing-lab-mcp/";
const out = "docs/img/demo.png";

/**
 * Resolves once every finite animation in the hero has finished (the opening print, the messages
 * and the receipt feed). Looping and scroll-driven animations elsewhere on the page are ignored.
 */
async function animationsDone(page) {
  await page.waitForFunction(
    () =>
      document.getAnimations().every((a) => {
        const target = a.effect?.target;
        if (!target?.closest?.(".hero")) return true;
        if (a.timeline !== document.timeline) return true;
        if (!Number.isFinite(a.effect.getComputedTiming().endTime)) return true;
        return a.playState === "finished" || a.playState === "idle";
      }),
    undefined,
    { timeout: 15_000 },
  );
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "msedge" });
const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  colorScheme: "light",
});
await page.goto(url, { waitUntil: "networkidle" });

// The hero conversation: the question, the first tool tickets and the opening of the answer.
const hero = page.locator("[data-hero-chat]");
await hero.locator(".chat__item--assistant").waitFor();
await animationsDone(page);

// Re-run the first recorded call and wait for its stamp.
const ticket = hero.locator(".ticket").first();
await ticket.locator(".ticket__run").click();
await page.waitForFunction(
  () =>
    document.querySelector("[data-hero-chat] .ticket")?.getAttribute("data-stamped") === "match",
  undefined,
  { timeout: 30_000 },
);
const stamp = await ticket.textContent();
if (!stamp?.includes("Matches recording")) throw new Error("The ticket was not stamped.");

// Let the stamp settle, move the pointer off the button and scroll back to the top.
await page.mouse.move(1270, 790);
await page.evaluate(() => window.scrollTo(0, 0));
await animationsDone(page);
await page.waitForTimeout(300);
await page.screenshot({ path: out });
await browser.close();
console.log(`Saved ${out}`);
