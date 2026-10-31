/**
 * A small Markdown reader for the assistant's recorded answers. It covers what Claude writes in
 * them: paragraphs, headings, bullet and numbered lists, pipe tables, **bold**, *italic*,
 * `code` and https links. Everything is built with createElement and textContent, never
 * innerHTML, so nothing in a transcript can inject markup. Anything it does not recognise stays
 * plain text.
 */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const INLINE = /(\*\*[^*\n]+?\*\*|`[^`\n]+`|\*[^*\s][^*\n]*?\*|\[[^\]\n]+\]\([^)\s]+\))/g;

/** Appends `text` to `parent`, turning inline Markdown into elements. */
export function appendInline(parent: HTMLElement, text: string): void {
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > last) parent.append(text.slice(last, start));
    last = start + token.length;
    if (token.startsWith("**")) {
      const strong = el("strong");
      appendInline(strong, token.slice(2, -2));
      parent.append(strong);
    } else if (token.startsWith("`")) {
      parent.append(el("code", "", token.slice(1, -1)));
    } else if (token.startsWith("[")) {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      if (/^https:\/\//.test(href)) {
        const link = el("a", "", label);
        link.href = href;
        link.rel = "noopener noreferrer";
        parent.append(link);
      } else {
        parent.append(label);
      }
    } else {
      const em = el("em");
      appendInline(em, token.slice(1, -1));
      parent.append(em);
    }
  }
  if (last < text.length) parent.append(text.slice(last));
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderTable(rows: string[]): HTMLElement {
  const wrap = el("div", "md__table");
  // A wide table scrolls inside its own box; keyboard users can focus it to scroll.
  wrap.tabIndex = 0;
  wrap.setAttribute("role", "region");
  wrap.setAttribute("aria-label", "Table");
  const table = el("table");
  const [head, ...body] = rows;
  if (head) {
    const tr = el("tr");
    for (const cell of cells(head)) {
      const th = el("th");
      th.scope = "col";
      appendInline(th, cell);
      tr.append(th);
    }
    table.append(el("thead"));
    table.tHead?.append(tr);
  }
  const tbody = el("tbody");
  for (const row of body) {
    const tr = el("tr");
    for (const cell of cells(row)) {
      const td = el("td");
      appendInline(td, cell);
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  wrap.append(table);
  return wrap;
}

export interface MarkdownOptions {
  /** Heading level for `#` and `##`; deeper headings use the next level. Defaults to 4. */
  headingLevel?: 3 | 4 | 5;
  /** Print headings as bold paragraphs, outside the page outline (the hero's preview). */
  plainHeadings?: boolean;
}

/** Renders Markdown text as a fragment of block elements. */
export function renderMarkdown(text: string, options: MarkdownOptions = {}): DocumentFragment {
  const level = options.headingLevel ?? 4;
  const out = document.createDocumentFragment();
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: HTMLOListElement | HTMLUListElement | undefined;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const p = el("p");
    appendInline(p, paragraph.join(" "));
    out.append(p);
    paragraph = [];
  };
  const closeList = () => {
    list = undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.trim() === "") {
      flushParagraph();
      closeList();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      closeList();
      const depth = (heading[1] as string).length;
      const tag = options.plainHeadings
        ? "p"
        : (`h${Math.min(6, depth <= 2 ? level : level + 1)}` as "h4");
      const h = el(tag, "md__heading");
      appendInline(h, heading[2] as string);
      out.append(h);
      continue;
    }
    if (TABLE_ROW.test(line) && TABLE_RULE.test(lines[i + 1] ?? "")) {
      flushParagraph();
      closeList();
      const rows = [line];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i] as string))
        rows.push(lines[i++] as string);
      i -= 1;
      out.append(renderTable(rows));
      continue;
    }
    if (RULE.test(line)) {
      flushParagraph();
      closeList();
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const tag = bullet ? "ul" : "ol";
      if (!list || list.tagName.toLowerCase() !== tag) {
        list = el(tag);
        out.append(list);
      }
      const li = el("li");
      appendInline(li, ((bullet ?? numbered) as RegExpExecArray)[1] as string);
      list.append(li);
      continue;
    }
    // An indented line right after a list item continues that item.
    if (list && /^\s+\S/.test(line) && paragraph.length === 0) {
      const item = list.lastElementChild as HTMLElement | null;
      if (item) {
        item.append(" ");
        appendInline(item, line.trim());
        continue;
      }
    }
    closeList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  return out;
}
