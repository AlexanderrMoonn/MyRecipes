// md.js — a tiny, safe Markdown renderer for the recipe box.
//
// Why hand-rolled instead of a library: the add form has no login, so anyone
// can submit text. We must never drop raw user text into innerHTML. This
// renderer starts by HTML-escaping the ENTIRE input, then adds back only a
// fixed, known set of tags (headings, bold, italic, lists, links, paragraphs,
// line breaks). Because escaping happens first, there is no way for submitted
// text to inject its own HTML or scripts — the only tags in the output are the
// ones this file writes.
//
// Supported syntax:
//   # / ## / ###        headings
//   **bold**  __bold__
//   *italic*  _italic_
//   - or *              bullet list
//   1. 2. 3.            numbered list
//   [text](https://…)   links (http/https/mailto only)
//   blank line          new paragraph
//
// Exposes window.renderMarkdown(text) -> HTML string.

(function () {
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Inline formatting runs on already-escaped text. It only ever inserts a
  // fixed set of tags, and link URLs are checked against a safe scheme.
  function renderInline(escaped) {
    let out = escaped;

    // Links: [label](url). The url here is still escaped text; we allow only
    // http(s) and mailto, and re-escape the label defensively.
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
      // url came through escapeHtml, so quotes are already &quot; etc.
      const safe = /^(https?:|mailto:)/i.test(url);
      if (!safe) return m; // leave it as literal text
      return `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>`;
    });

    // Bold before italic so ** isn't eaten by the single-char rules.
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
    out = out.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");

    return out;
  }

  function renderMarkdown(text) {
    if (text == null) return "";
    // 1) Escape everything first — this is the safety guarantee.
    const escaped = escapeHtml(String(text)).replace(/\r\n/g, "\n");
    const lines = escaped.split("\n");

    const html = [];
    let listType = null; // "ul" | "ol" | null
    let paragraph = [];

    function flushParagraph() {
      if (paragraph.length) {
        html.push("<p>" + renderInline(paragraph.join("<br>")) + "</p>");
        paragraph = [];
      }
    }
    function closeList() {
      if (listType) {
        html.push(`</${listType}>`);
        listType = null;
      }
    }

    for (const raw of lines) {
      const line = raw.trimEnd();

      // blank line -> paragraph / list break
      if (!line.trim()) {
        flushParagraph();
        closeList();
        continue;
      }

      // headings
      const h = line.match(/^(#{1,3})\s+(.*)$/);
      if (h) {
        flushParagraph();
        closeList();
        const level = h[1].length;
        html.push(`<h${level}>` + renderInline(h[2].trim()) + `</h${level}>`);
        continue;
      }

      // ordered list item
      const ol = line.match(/^\s*\d+\.\s+(.*)$/);
      if (ol) {
        flushParagraph();
        if (listType !== "ol") {
          closeList();
          listType = "ol";
          html.push("<ol>");
        }
        html.push("<li>" + renderInline(ol[1].trim()) + "</li>");
        continue;
      }

      // unordered list item (- or *)
      const ul = line.match(/^\s*[-*]\s+(.*)$/);
      if (ul) {
        flushParagraph();
        if (listType !== "ul") {
          closeList();
          listType = "ul";
          html.push("<ul>");
        }
        html.push("<li>" + renderInline(ul[1].trim()) + "</li>");
        continue;
      }

      // normal text line -> accumulate into a paragraph
      closeList();
      paragraph.push(line);
    }

    flushParagraph();
    closeList();
    return html.join("\n");
  }

  window.renderMarkdown = renderMarkdown;
})();
