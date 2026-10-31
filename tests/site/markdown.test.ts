// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../site/src/markdown";

function render(text: string): HTMLElement {
  const root = document.createElement("div");
  root.append(renderMarkdown(text));
  return root;
}

describe("renderMarkdown", () => {
  it("builds paragraphs, headings, lists and inline marks", () => {
    const root = render(
      "Intro with **bold**, *italic* and `code`.\nSame paragraph.\n\n## Title\n\n- one\n- **two**\n\n1. first\n2. second",
    );
    expect([...root.children].map((c) => c.tagName)).toEqual(["P", "H4", "UL", "OL"]);
    expect(root.querySelector("p")?.textContent).toBe(
      "Intro with bold, italic and code. Same paragraph.",
    );
    expect(root.querySelector("p strong")?.textContent).toBe("bold");
    expect(root.querySelector("p em")?.textContent).toBe("italic");
    expect(root.querySelector("p code")?.textContent).toBe("code");
    expect(root.querySelectorAll("ul li")).toHaveLength(2);
    expect(root.querySelector("ul li strong")?.textContent).toBe("two");
    expect(root.querySelectorAll("ol li")).toHaveLength(2);
  });

  it("builds a table with header cells and inline marks in cells", () => {
    const root = render(
      "| Channel | Share |\n|---|---:|\n| **display** | 32.7% |\n| direct | 2.4% |",
    );
    const table = root.querySelector(".md__table table");
    expect(table?.querySelectorAll("thead th")).toHaveLength(2);
    expect(table?.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(table?.querySelector("tbody td strong")?.textContent).toBe("display");
    expect(root.querySelector(".md__table")?.getAttribute("tabindex")).toBe("0");
  });

  it("leaves snake_case names and lone asterisks alone", () => {
    const root = render("health_beauty and bed_bath_table, 5 * 3");
    expect(root.querySelector("em")).toBeNull();
    expect(root.textContent).toBe("health_beauty and bed_bath_table, 5 * 3");
  });

  it("never turns text into markup", () => {
    const root = render(
      '<img src=x onerror="alert(1)"> **<script>alert(2)</script>**\n\n| <b>x</b> |\n|---|\n| <i>y</i> |',
    );
    expect(root.querySelector("img, script, b, i")).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(root.querySelector("strong")?.textContent).toBe("<script>alert(2)</script>");
  });

  it("links only https URLs", () => {
    const root = render("[docs](https://example.com/a) and [bad](javascript:alert(1))");
    const links = root.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe("https://example.com/a");
    expect(links[0]?.rel).toBe("noopener noreferrer");
    expect(root.textContent).toContain("bad");
  });
});

describe("plain headings", () => {
  it("prints headings as bold paragraphs, outside the outline", () => {
    const root = document.createElement("div");
    root.append(renderMarkdown("## Did it work? Yes\n\nText.", { plainHeadings: true }));
    expect(root.querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
    expect(root.querySelector("p.md__heading")?.textContent).toBe("Did it work? Yes");
  });
});
