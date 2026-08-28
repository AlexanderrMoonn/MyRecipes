(function () {
  const form = document.getElementById("recipe-form");
  const status = document.getElementById("form-status");
  const submitBtn = document.getElementById("submit-btn");
  const photoInput = document.getElementById("photo");
  const photoPreview = document.getElementById("photo-preview");
  const photoPreviewImg = document.getElementById("photo-preview-img");
  const removePhotoField = document.getElementById("removePhoto");
  const recipeIdField = document.getElementById("recipe-id");

  const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB

  // ------------------------------------------------------------------
  // Live Markdown editor
  //
  // Each editable field is a contenteditable <div> (a plain textarea can't
  // show styled text). As you type, the text between Markdown markers is
  // styled live while the markers themselves stay visible but dimmed, so what
  // you edit is always the real Markdown. The plain-text Markdown is mirrored
  // into a hidden <input> so the form submits exactly what gets stored.
  //
  // Every rendered line is its own block-level element (see .md-line in
  // style.css), which is what makes Enter actually start a new visual line.
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
    if (line === "") return '<span class="md-line md-blank"><br></span>';
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
    const text = [];
    el.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text.push(node.textContent);
      } else if (node.nodeName === "BR") {
        text.push("\n");
      } else {
        // a rendered line wrapper (.md-line) — its textContent is the line
        text.push(node.textContent);
        text.push("\n");
      }
    });
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

  // Map an editor id -> its {el, hidden} for programmatic filling (import, edit).
  const editorById = {};
  editors.forEach((pair) => {
    editorById[pair.el.id.replace(/-editor$/, "")] = pair;
  });

  // Set an editor's content from a plain Markdown string and re-highlight it.
  function setEditorText(id, text) {
    const pair = editorById[id];
    if (!pair) return;
    const lines = String(text || "").split("\n");
    pair.el.innerHTML = "";
    lines.forEach((line, i) => {
      pair.el.appendChild(document.createTextNode(line));
      if (i < lines.length - 1) pair.el.appendChild(document.createElement("br"));
    });
    renderEditor(pair.el, pair.hidden);
  }

  // ------------------------------------------------------------------
  // Formatting toolbar
  //
  // Buttons insert Markdown markers at the caret (or around the current
  // selection for bold/italic), then re-render so the styling shows up
  // immediately — no need to memorize the syntax.
  // ------------------------------------------------------------------

  document.querySelectorAll(".md-toolbar button[data-action]").forEach((btn) => {
    const toolbar = btn.closest(".md-toolbar");
    const targetId = toolbar && toolbar.getAttribute("data-target");
    const pair = targetId && editorById[targetId];
    if (!pair) return;

    btn.addEventListener("click", () => {
      const { el, hidden } = pair;
      el.focus();
      const sel = window.getSelection();
      const chosen = sel && sel.rangeCount ? sel.toString() : "";
      const action = btn.getAttribute("data-action");

      let insertText;
      switch (action) {
        case "bold":
          insertText = `**${chosen || "bold text"}**`;
          break;
        case "italic":
          insertText = `*${chosen || "italic text"}*`;
          break;
        case "bullet":
          insertText = chosen ? `- ${chosen}` : "- ";
          break;
        case "number":
          insertText = chosen ? `1. ${chosen}` : "1. ";
          break;
        case "heading":
          insertText = chosen ? `## ${chosen}` : "## ";
          break;
        default:
          return;
      }

      document.execCommand("insertText", false, insertText);
      renderEditor(el, hidden);
    });
  });

  // ------------------------------------------------------------------
  // Import from link (Preview)
  // ------------------------------------------------------------------

  const importUrl = document.getElementById("import-url");
  const importBtn = document.getElementById("import-btn");
  const importStatus = document.getElementById("import-status");
  const nameField = document.getElementById("name");
  const photoUrlField = document.getElementById("photoUrl");
  const importedPhoto = document.getElementById("imported-photo");
  const importedPhotoImg = document.getElementById("imported-photo-img");
  const importedPhotoClear = document.getElementById("imported-photo-clear");

  function clearImportedPhoto() {
    if (photoUrlField) photoUrlField.value = "";
    if (importedPhoto) importedPhoto.setAttribute("hidden", "");
    if (importedPhotoImg) importedPhotoImg.removeAttribute("src");
  }

  if (importedPhotoClear) {
    importedPhotoClear.addEventListener("click", clearImportedPhoto);
  }

  async function doImport() {
    const url = (importUrl.value || "").trim();
    if (!/^https?:\/\//i.test(url)) {
      importStatus.textContent = "Paste a full link starting with http:// or https://.";
      importStatus.className = "import-status error";
      importUrl.focus();
      return;
    }

    importBtn.disabled = true;
    const originalLabel = importBtn.textContent;
    importBtn.textContent = "Reading…";
    importStatus.textContent = "Reading that page…";
    importStatus.className = "import-status pending";

    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
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
          "Link import isn't set up on the server yet. See README, or add the recipe by hand."
        );
      }
      if (!res.ok || !data) {
        throw new Error((data && data.error) || "Couldn't import that link.");
      }

      if (nameField) nameField.value = data.name || "";
      setEditorText("ingredients", data.ingredients || "");
      setEditorText("instructions", data.instructions || "");
      setEditorText("notes", data.notes || "");

      if (data.photoUrl) {
        photoUrlField.value = data.photoUrl;
        importedPhotoImg.src = data.photoUrl;
        importedPhoto.removeAttribute("hidden");
        hideCurrentPhoto(); // an import supersedes the existing photo preview
      } else {
        clearImportedPhoto();
      }

      importStatus.textContent =
        "Imported. Review and edit below, then Publish. Nothing is saved yet.";
      importStatus.className = "import-status success";
      if (nameField) nameField.focus();
    } catch (err) {
      importStatus.textContent = (err && err.message) || "Couldn't import that link.";
      importStatus.className = "import-status error";
    } finally {
      importBtn.disabled = false;
      importBtn.textContent = originalLabel;
    }
  }

  if (importBtn) {
    importBtn.addEventListener("click", doImport);
    importUrl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        doImport();
      }
    });
  }

  // ------------------------------------------------------------------
  // Photo preview
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
    // A newly chosen file takes priority over "remove" intent.
    removePhotoField.value = "";
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
  // Edit mode — reuses this same form, pre-filled, gated by a password.
  // ------------------------------------------------------------------

  const pageTitle = document.getElementById("page-title");
  const drawerLabel = document.getElementById("drawer-label");
  const pageTagline = document.getElementById("page-tagline");
  const editBanner = document.getElementById("edit-banner");
  const passwordPanel = document.getElementById("password-panel");
  const passwordField = document.getElementById("edit-password");
  const passwordError = document.getElementById("password-error");
  const rememberPassword = document.getElementById("remember-password");
  const currentPhoto = document.getElementById("current-photo");
  const currentPhotoImg = document.getElementById("current-photo-img");
  const currentPhotoClear = document.getElementById("current-photo-clear");

  let isEditMode = false;
  let editId = null;

  function isValidId(id) {
    return /^[a-z0-9-]+$/.test(id);
  }

  function hideCurrentPhoto() {
    if (currentPhoto) currentPhoto.setAttribute("hidden", "");
    if (removePhotoField) removePhotoField.value = "1";
  }

  if (currentPhotoClear) {
    currentPhotoClear.addEventListener("click", hideCurrentPhoto);
  }

  const SESSION_KEY = "familyRecipesEditPassword";

  async function initEditMode() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("edit");
    if (!id || !isValidId(id)) return;

    isEditMode = true;
    editId = id;
    if (recipeIdField) recipeIdField.value = id;

    pageTitle.textContent = "Edit Recipe — Family Recipes";
    drawerLabel.textContent = "Edit Card";
    pageTagline.textContent = "Update the card below, then save your changes.";
    submitBtn.textContent = "Save changes";

    passwordPanel.removeAttribute("hidden");
    const remembered = sessionStorage.getItem(SESSION_KEY);
    if (remembered) passwordField.value = remembered;

    editBanner.textContent = "Loading this recipe for editing…";
    editBanner.removeAttribute("hidden");

    try {
      const res = await fetch(`/recipes/${encodeURIComponent(id)}.json`, { cache: "no-cache" });
      if (!res.ok) throw new Error("Couldn't find that recipe.");
      const recipe = await res.json();

      if (nameField) nameField.value = recipe.name || "";
      setEditorText("ingredients", recipe.ingredients || "");
      setEditorText("instructions", recipe.instructions || "");
      setEditorText("notes", recipe.notes || "");

      if (recipe.photo) {
        currentPhotoImg.src = `/photos/${encodeURIComponent(recipe.photo)}`;
        currentPhoto.removeAttribute("hidden");
        if (removePhotoField) removePhotoField.value = "";
      }

      editBanner.textContent = `Editing "${recipe.name}". Changes save when you submit below.`;
    } catch (err) {
      editBanner.textContent =
        (err && err.message) || "Couldn't load that recipe. You can still fill out the form manually.";
    }
  }

  initEditMode();

  // ------------------------------------------------------------------
  // Submit
  // ------------------------------------------------------------------

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    status.textContent = "";
    status.className = "form-status";
    if (passwordError) passwordError.textContent = "";

    syncAll();

    const name = form.name.value.trim();
    const ingredients = form.ingredients.value.trim();
    const instructions = form.instructions.value.trim();

    if (!name || !ingredients || !instructions) {
      status.textContent = "Please fill in the recipe name, ingredients, and instructions.";
      status.className = "form-status error";
      return;
    }

    if (isEditMode && !passwordField.value.trim()) {
      passwordError.textContent = "Enter the family password to save changes.";
      passwordField.focus();
      return;
    }

    const photoFile = photoInput.files && photoInput.files[0];
    if (photoFile && photoFile.size > MAX_PHOTO_BYTES) {
      status.textContent = "That photo is too large (5MB max). Pick a smaller one.";
      status.className = "form-status error";
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = isEditMode ? "Saving…" : "Filing…";
    status.textContent = isEditMode ? "Saving your changes…" : "Filing this recipe…";
    status.className = "form-status pending";

    try {
      const formData = new FormData(form);
      const endpoint = isEditMode ? "/api/edit" : "/api/recipes";
      const res = await fetch(endpoint, {
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
          isEditMode
            ? "Editing from the site isn't set up yet. See README."
            : "Adding from the site isn't set up yet. See README (\"Enable adding recipes from the site\"), or add the recipe as a file in recipes/ on the backend."
        );
      }
      if (res.status === 401) {
        throw new Error((data && data.error) || "That password isn't right.");
      }
      if (!res.ok) {
        throw new Error((data && data.error) || `Could not save that recipe (server said: ${res.status}).`);
      }
      if (!data || !data.id) {
        throw new Error("The server gave an unexpected response. Please try again.");
      }

      if (isEditMode) {
        if (rememberPassword && rememberPassword.checked) {
          sessionStorage.setItem(SESSION_KEY, passwordField.value);
        } else {
          sessionStorage.removeItem(SESSION_KEY);
        }
        status.textContent = "Changes saved! The recipe will update within about a minute, once the site finishes rebuilding.";
        status.className = "form-status success";
        submitBtn.textContent = "Saved ✓";
      } else {
        status.textContent =
          "Recipe published! It'll appear in the box within about a minute, once the site finishes rebuilding.";
        status.className = "form-status success";
        form.reset();
        editors.forEach(({ el, hidden }) => {
          el.innerHTML = "";
          hidden.value = "";
          el.classList.add("is-empty");
        });
        photoPreview.style.display = "none";
        clearImportedPhoto();
        if (importUrl) importUrl.value = "";
        if (importStatus) {
          importStatus.textContent = "";
          importStatus.className = "import-status";
        }
        submitBtn.textContent = "Published ✓";
      }
    } catch (err) {
      status.textContent = (err && err.message) || "Something went wrong. Please try again.";
      status.className = "form-status error";
      submitBtn.disabled = false;
      submitBtn.textContent = isEditMode ? "Save changes" : "Publish recipe";
    }
  });
})();
