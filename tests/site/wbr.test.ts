// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mountPlayground } from "../../site/src/playground";
import { renderTicket } from "../../site/src/ticket";
import { breakAtUnderscores } from "../../site/src/wbr";

function html(fragment: DocumentFragment): string {
  const box = document.createElement("div");
  box.append(fragment);
  return box.innerHTML;
}

describe("breakAtUnderscores", () => {
  it("puts a <wbr> after every underscore and nowhere else", () => {
    expect(html(breakAtUnderscores("email_test_analyze"))).toBe("email_<wbr>test_<wbr>analyze");
    expect(html(breakAtUnderscores("tools"))).toBe("tools");
    expect(html(breakAtUnderscores("trailing_"))).toBe("trailing_");
  });

  it("never parses markup in the name", () => {
    const box = document.createElement("div");
    box.append(breakAtUnderscores("<img_src=x>"));
    expect(box.querySelector("img")).toBeNull();
    expect(box.textContent).toBe("<img_src=x>");
  });
});

describe("long tool names", () => {
  it("wrap at underscores on the ticket, with the text unchanged", () => {
    const ticket = renderTicket({ tool: "email_test_analyze", input: {} });
    const name = ticket.querySelector(".ticket__tool");
    expect(name?.textContent).toBe("email_test_analyze");
    expect(name?.querySelectorAll("wbr")).toHaveLength(2);
  });

  it("wrap at underscores in the playground's tool list and form title", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    await mountPlayground(root, { liveUrl: "" });
    const listed = root.querySelector('.pg__tool[data-tool="attribution_compare"] .pg__tool-name');
    expect(listed?.textContent).toBe("attribution_compare");
    expect(listed?.querySelectorAll("wbr")).toHaveLength(1);
    expect(root.querySelector(".pg__form-name wbr")).not.toBeNull();
    root.remove();
  });
});
