(function () {
  const form = document.getElementById("recipe-form");
  const status = document.getElementById("form-status");
  const submitBtn = document.getElementById("submit-btn");
  const photoInput = document.getElementById("photo");
  const photoPreview = document.getElementById("photo-preview");
  const photoPreviewImg = document.getElementById("photo-preview-img");

  const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB

  // ------------------------------------------------------------------
  // Live Markdown editor
  //
  // Each editable field is a contenteditable <div> (a plain textarea can't
  // show styled text). As you type, the text between Markdown markers is
  // styled live while the markers themselves stay visible but dimmed, so what
  // you edit is always the real Markdown. The plain-text Markdown is mirrored
  // into a hidden <input> so the form submits exactly what gets stored.
  // ------------------------------------------------------------------

  const EDITORS = ["ingredients", "instructions", "notes"];

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // Turn one line of raw Markdown text into highlighted HTML. Markers are kept
  // (wrapped in a dim <span class="md-mark">) so the source stays visible.
  function highlightLine(line) {
    if (line === "") return "<br>";
    let html = escapeHtml(line);

    // Heading: leading #, ##, ### (keep the hashes, style the whole line)
    const h = html.match(/^(#{1,3})(\s+)(.*)$/);
    if (h) {
      const level = h[1].length;
      return (
        `<span class="md-line md-h${level}">` +
        `<span class="md-mark">${h[1]}${h[2]}</span>` +
        inlineHighlight(h[3]) +
        `</span>`
      );
    }

    // List item: leading "- " or "* " or "1. "
    const ul = html.match(/^(\s*)([-*])(\s+)(.*)$/);
    if (ul) {
      return (
        `<span class="md-line">${ul[1]}` +
        `<span class="md-mark">${ul[2]}${ul[3]}</span>` +
        inlineHighlight(ul[4]) +
        `</span>`
      );
    }
    const ol = html.match(/^(\s*)(\d+\.)(\s+)(.*)$/);
    if (ol) {
      return (
        `<span class="md-line">${ol[1]}` +
        `<span class="md-mark">${ol[2]}${ol[3]}</span>` +
        inlineHighlight(ol[4]) +
        `</span>`
      );
    }

    return `<span class="md-line">${inlineHighlight(html)}</span>`;
  }

  // Inline: **bold**, __bold__, *italic*, _italic_ — markers kept but dimmed.
  function inlineHighlight(s) {
    let out = s;
    out = out.replace(
      /\*\*([^*]+)\*\*/g,
      '<span class="md-mark">**</span><strong>$1</strong><span class="md-mark">**</span>'
    );
    out = out.replace(
      /__([^_]+)__/g,
      '<span class="md-mark">__</span><strong>$1</strong><span class="md-mark">__</span>'
    );
    out = out.replace(
      /(^|[^*])\*([^*\n]+)\*(?!\*)/g,
      '$1<span class="md-mark">*</span><em>$2</em><span class="md-mark">*</span>'
    );
    out = out.replace(
      /(^|[^_])_([^_\n]+)_(?!_)/g,
      '$1<span class="md-mark">_</span><em>$2</em><span class="md-mark">_</span>'
    );
    return out;
  }

  // Read the editor's text content as plain Markdown (newlines preserved).
  function getPlainText(el) {
    // Each top-level line is a block; reconstruct newlines from the DOM.
    const text = [];
    el.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text.push(node.textContent);
      } else if (node.nodeName === "BR") {
        text.push("\n");
      } else {
        // a rendered line wrapper — its textContent is the line, add newline
        text.push(node.textContent);
        text.push("\n");
      }
    });
    // Collapse the trailing newline the loop may add, normalize.
    return text.join("").replace(/\n$/, "");
  }

  // Save & restore caret by character offset within the editor.
  function getCaretOffset(el) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const pre = range.cloneRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.endContainer, range.endOffset);
    return pre.toString().length;
  }

  function setCaretOffset(el, offset) {
    if (offset == null) return;
    let remaining = offset;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      const len = node.textContent.length;
      if (remaining <= len) {
        const range = document.createRange();
        range.setStart(node, remaining);
        range.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      remaining -= len;
    }
    // fell through — put caret at end
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function renderEditor(el, hidden) {
    const text = getPlainText(el);
    const caret = el === document.activeElement ? getCaretOffset(el) : null;
    const lines = text.split("\n");
    el.innerHTML = lines.map(highlightLine).join("");
    if (caret != null) setCaretOffset(el, caret);
    if (hidden) hidden.value = text;
    // toggle empty state for placeholder
    el.classList.toggle("is-empty", text.length === 0);
  }

  const editors = [];
  EDITORS.forEach((id) => {
    const el = document.getElementById(id + "-editor");
    const hidden = document.getElementById(id);
    if (!el || !hidden) return;
    editors.push({ el, hidden });

    el.addEventListener("input", () => renderEditor(el, hidden));

    // Enter inserts a newline as plain text (avoid contenteditable <div> soup).
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        document.execCommand("insertText", false, "\n");
      }
      // Ctrl/Cmd+B / +I wrap the selection in markers.
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === "b" || k === "i") {
          e.preventDefault();
          const marker = k === "b" ? "**" : "*";
          const sel = window.getSelection();
          const chosen = sel.toString();
          document.execCommand(
            "insertText",
            false,
            marker + (chosen || (k === "b" ? "bold" : "italic")) + marker
          );
          renderEditor(el, hidden);
        }
      }
    });

    // Paste as plain text so no foreign HTML enters the editor.
    el.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text/plain");
      document.execCommand("insertText", false, text);
    });

    el.classList.add("is-empty");
  });

  function syncAll() {
    editors.forEach(({ el, hidden }) => {
      hidden.value = getPlainText(el);
    });
  }

  // ------------------------------------------------------------------
  // Photo preview (unchanged)
  // ------------------------------------------------------------------

  photoInput.addEventListener("change", () => {
    const file = photoInput.files && photoInput.files[0];
    if (!file) {
      photoPreview.style.display = "none";
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      status.textContent = "That photo is too large (5MB max). Pick a smaller one.";
      status.className = "form-status error";
      photoInput.value = "";
      photoPreview.style.display = "none";
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      photoPreviewImg.src = e.target.result;
      photoPreview.style.display = "block";
    };
    reader.onerror = () => {
      photoPreview.style.display = "none";
    };
    reader.readAsDataURL(file);
  });

  // ------------------------------------------------------------------
  // Submit
  // ------------------------------------------------------------------

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    status.textContent = "";
    status.className = "form-status";

    syncAll();

    const name = form.name.value.trim();
    const ingredients = form.ingredients.value.trim();
    const instructions = form.instructions.value.trim();

    if (!name || !ingredients || !instructions) {
      status.textContent = "Please fill in the recipe name, ingredients, and instructions.";
      status.className = "form-status error";
      return;
    }

    const photoFile = photoInput.files && photoInput.files[0];
    if (photoFile && photoFile.size > MAX_PHOTO_BYTES) {
      status.textContent = "That photo is too large (5MB max). Pick a smaller one.";
      status.className = "form-status error";
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Filing…";
    status.textContent = "Filing this recipe…";
    status.className = "form-status pending";

    try {
      const formData = new FormData(form);
      const res = await fetch("/api/recipes", {
        method: "POST",
        body: formData,
      });

      const contentType = res.headers.get("content-type") || "";
      let data = null;
      if (contentType.includes("application/json")) {
        try {
          data = await res.json();
        } catch {
          data = null;
        }
      }

      if (res.status === 404) {
        throw new Error(
          "Adding from the site isn't set up yet. See README (\"Enable adding recipes from the site\"), or add the recipe as a file in recipes/ on the backend."
        );
      }
      if (!res.ok) {
        throw new Error((data && data.error) || `Could not file that recipe (server said: ${res.status}).`);
      }
      if (!data || !data.id) {
        throw new Error("The server gave an unexpected response. Please try again.");
      }

      status.textContent =
        "Recipe filed! It'll appear in the box within about a minute, once the site finishes rebuilding.";
      status.className = "form-status success";
      form.reset();
      editors.forEach(({ el, hidden }) => {
        el.innerHTML = "";
        hidden.value = "";
        el.classList.add("is-empty");
      });
      photoPreview.style.display = "none";
      submitBtn.textContent = "Filed ✓";
    } catch (err) {
      status.textContent = (err && err.message) || "Something went wrong. Please try again.";
      status.className = "form-status error";
      submitBtn.disabled = false;
      submitBtn.textContent = "File this recipe";
    }
  });
})();
