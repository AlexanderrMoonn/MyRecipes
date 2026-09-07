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

  // The header's category bar is shared with the rest of the site; nothing
  // in it is the "current" page while you are filling in this form.
  Site.renderCategoryNav(null);

  // ------------------------------------------------------------------
  // Markdown editor
  //
  // Each editable field is a plain <textarea>: the browser owns the caret,
  // the selection, undo/redo, IME, autocorrect and mobile keyboards, so
  // typing behaves exactly the way typing is supposed to. (The previous
  // version was a contenteditable div that re-rendered itself on every
  // keystroke and then restored the caret from a character offset measured
  // without the line breaks it had just written — which is why Enter left
  // the caret on the old line and Backspace jumped up a line.)
  //
  // What we add on top of the textarea is only ever *text* editing:
  //   - a live preview underneath, rendered by the very same md.js the
  //     recipe page uses, so what you see is what gets filed;
  //   - toolbar buttons and Ctrl/Cmd+B / Ctrl/Cmd+I that wrap the selection;
  //   - Enter continuing a "- " or "1. " list, the way notes apps do;
  //   - the box growing to fit what you have written.
  //
  // Typing is left entirely to the browser; every *scripted* edit goes
  // through replaceRange() -> execCommand("insertText"), which keeps those
  // changes on the browser's native undo stack too.
  // ------------------------------------------------------------------

  const EDITORS = ["ingredients", "instructions", "notes"];

  // id -> editor state
  const editorById = {};
  const editors = [];

  // Markdown that renders to something other than the lines you typed. Plain
  // lines already look like the card, so a preview of them is just the same
  // text twice — the panel only earns its space once there is syntax in play.
  const MARKDOWN_RE = [
    /^[ \t]*#{1,3}[ \t]+\S/m, // heading
    /^[ \t]*[-*][ \t]+\S/m, // bullet
    /^[ \t]*\d+\.[ \t]+\S/m, // numbered
    /\*\*[^*\n]+\*\*/, // **bold**
    /__[^_\n]+__/, // __bold__
    /(^|[^*])\*[^*\n]+\*(?!\*)/, // *italic*
    /(^|[^_])_[^_\n]+_(?!_)/, // _italic_
    /\[[^\]\n]+\]\([^)\s]+\)/, // [link](url)
    /\n[ \t]*\n/, // blank line = new paragraph
  ];

  function looksLikeMarkdown(text) {
    return MARKDOWN_RE.some((re) => re.test(text));
  }

  function renderPreview(pair) {
    const text = pair.input.value;
    if (!pair.preview) return;
    if (!text.trim() || !looksLikeMarkdown(text)) {
      pair.preview.setAttribute("hidden", "");
      pair.previewBody.innerHTML = "";
      return;
    }
    // renderMarkdown escapes everything before adding back its own fixed set
    // of tags, so submitted text can never inject markup here.
    pair.previewBody.innerHTML =
      typeof window.renderMarkdown === "function"
        ? window.renderMarkdown(text)
        : "";
    pair.preview.removeAttribute("hidden");
  }

  // Grow the box to fit its content instead of scrolling inside a fixed
  // window — a recipe is read all at once, so it should be visible all at once.
  // scrollHeight covers content + padding only, so add the borders back or
  // box-sizing: border-box leaves the last line clipped by a couple of pixels.
  function autoGrow(input) {
    const cs = window.getComputedStyle(input);
    const borders =
      (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    input.style.height = "auto";
    input.style.height = input.scrollHeight + borders + "px";
  }

  function sync(pair) {
    autoGrow(pair.input);
    renderPreview(pair);
  }

  // Replace [start, end) with `text`, then leave the selection at
  // [selStart, selEnd] (defaults to a caret after the inserted text).
  // Uses execCommand so the edit lands on the native undo stack; falls back
  // to setRangeText where that is unavailable.
  function replaceRange(input, start, end, text, selStart, selEnd) {
    const pair = editorById[input.id];
    input.focus();
    input.setSelectionRange(start, end);

    let handled = false;
    try {
      handled =
        text === ""
          ? end > start && document.execCommand("delete")
          : document.execCommand("insertText", false, text);
    } catch (err) {
      handled = false;
    }
    if (!handled) {
      input.setRangeText(text, start, end, "end");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    const caret = start + text.length;
    input.setSelectionRange(
      selStart == null ? caret : selStart,
      selEnd == null ? (selStart == null ? caret : selStart) : selEnd
    );
    if (pair) sync(pair);
  }

  // The [start, end) span of whole lines touched by the current selection.
  function selectedLineRange(input) {
    const value = input.value;
    let start = value.lastIndexOf("\n", Math.max(0, input.selectionStart - 1)) + 1;
    let end = value.indexOf("\n", input.selectionEnd);
    if (end === -1) end = value.length;
    return { start, end };
  }

  const BULLET_RE = /^(\s*)([-*])(\s+)(.*)$/;
  const NUMBER_RE = /^(\s*)(\d+)\.(\s+)(.*)$/;
  const HEADING_RE = /^(\s*)(#{1,3})(\s+)(.*)$/;

  // Add a "- ", "1. " or "## " prefix to every selected line — or strip it
  // again if the lines already have it, so the buttons toggle.
  function applyLinePrefix(input, kind) {
    const { start, end } = selectedLineRange(input);
    const lines = input.value.slice(start, end).split("\n");
    const re = kind === "bullet" ? BULLET_RE : kind === "number" ? NUMBER_RE : HEADING_RE;
    const allPrefixed = lines.every((line) => !line.trim() || re.test(line));

    let n = 0;
    const out = lines.map((line) => {
      if (!line.trim()) return line;
      const m = line.match(re);
      if (allPrefixed && m) return m[1] + m[4];
      const body = stripLinePrefix(line);
      n += 1;
      if (kind === "bullet") return body.indent + "- " + body.text;
      if (kind === "number") return body.indent + n + ". " + body.text;
      return body.indent + "## " + body.text;
    });

    const replacement = out.join("\n");
    replaceRange(input, start, end, replacement, start, start + replacement.length);
  }

  // Split a line into its indent and its text, dropping any list/heading
  // marker it already carries so the markers never stack up.
  function stripLinePrefix(line) {
    const m = line.match(BULLET_RE) || line.match(NUMBER_RE) || line.match(HEADING_RE);
    if (m) return { indent: m[1], text: m[4] };
    const indent = (line.match(/^\s*/) || [""])[0];
    return { indent, text: line.slice(indent.length) };
  }

  // Wrap the selection in `marker` — or unwrap it if it is already wrapped.
  // With nothing selected, drop in placeholder text and select it so the
  // next keystroke replaces it.
  function toggleWrap(input, marker) {
    const value = input.value;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const chosen = value.slice(start, end);
    const len = marker.length;

    if (chosen) {
      if (chosen.startsWith(marker) && chosen.endsWith(marker) && chosen.length > len * 2) {
        const inner = chosen.slice(len, -len);
        replaceRange(input, start, end, inner, start, start + inner.length);
        return;
      }
      if (value.slice(start - len, start) === marker && value.slice(end, end + len) === marker) {
        replaceRange(input, start - len, end + len, chosen, start - len, start - len + chosen.length);
        return;
      }
      const wrapped = marker + chosen + marker;
      replaceRange(input, start, end, wrapped, start + len, start + len + chosen.length);
      return;
    }

    const placeholder = marker === "**" ? "bold text" : "italic text";
    replaceRange(
      input,
      start,
      end,
      marker + placeholder + marker,
      start + len,
      start + len + placeholder.length
    );
  }

  // Enter inside a list carries the list on: "- " starts another bullet,
  // "1. " counts up. Enter on an item you never filled in clears the marker
  // instead, which is how you get back out of a list.
  function handleListEnter(e, input) {
    if (e.shiftKey || input.selectionStart !== input.selectionEnd) return false;

    const caret = input.selectionStart;
    const lineStart = input.value.lastIndexOf("\n", caret - 1) + 1;
    const line = input.value.slice(lineStart, caret);

    const bullet = line.match(BULLET_RE);
    const number = bullet ? null : line.match(NUMBER_RE);
    if (!bullet && !number) return false;

    const m = bullet || number;
    if (!m[4].trim()) {
      // empty item -> drop the marker and stay put
      e.preventDefault();
      replaceRange(input, lineStart, caret, m[1]);
      return true;
    }

    e.preventDefault();
    const next = bullet
      ? m[1] + m[2] + m[3]
      : m[1] + (parseInt(m[2], 10) + 1) + "." + m[3];
    replaceRange(input, caret, caret, "\n" + next);
    return true;
  }

  EDITORS.forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;
    const preview = document.getElementById(id + "-preview");
    const pair = {
      id,
      input,
      preview,
      previewBody: preview ? preview.querySelector(".rich-text") : null,
      savedSelection: null,
    };
    editorById[id] = pair;
    editors.push(pair);

    input.addEventListener("input", () => sync(pair));

    // Tapping a toolbar button on a touch screen blurs the field, and the
    // selection goes with it. Remember where the caret was so the button can
    // put it back.
    input.addEventListener("blur", () => {
      pair.savedSelection = [input.selectionStart, input.selectionEnd];
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        handleListEnter(e, input);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "b" || k === "i") {
          e.preventDefault();
          toggleWrap(input, k === "b" ? "**" : "*");
        }
      }
    });

    sync(pair);
  });

  // Wrapping changes with the width of the page, so the boxes have to be
  // re-measured when it changes (rotating a phone, most often).
  window.addEventListener("resize", () => {
    editors.forEach((pair) => autoGrow(pair.input));
  });

  // Set a field's content from a plain Markdown string (import, edit mode).
  function setEditorText(id, text) {
    const pair = editorById[id];
    if (!pair) return;
    pair.input.value = String(text || "");
    sync(pair);
  }

  function resetEditors() {
    editors.forEach((pair) => {
      pair.input.value = "";
      sync(pair);
    });
  }

  // ------------------------------------------------------------------
  // Category tags
  //
  // The presets are real checkboxes (so the form posts them as repeated
  // "tags" values, and a keyboard reaches them the ordinary way) styled as
  // chips. Anything that isn't a preset goes in the free-text box beside
  // them and is merged server-side.
  // ------------------------------------------------------------------

  const tagChoices = document.getElementById("tag-choices");
  const customTags = document.getElementById("custom-tags");

  if (tagChoices) {
    tagChoices.innerHTML = Site.CATEGORIES.map(
      (label) =>
        `<label class="tag-choice">` +
        `<input type="checkbox" name="tags" value="${Site.escapeHtml(label)}" />` +
        `<span>${Site.escapeHtml(label)}</span>` +
        `</label>`
    ).join("");
  }

  // Tick the presets a recipe already carries; anything else becomes the
  // starting text of the custom box, so editing never silently drops a tag.
  function setTags(tags) {
    const list = Site.normalizeTags(tags);
    const bySlug = new Map(list.map((tag) => [Site.slugify(tag), tag]));

    document.querySelectorAll('#tag-choices input[name="tags"]').forEach((box) => {
      const slug = Site.slugify(box.value);
      box.checked = bySlug.has(slug);
      bySlug.delete(slug);
    });

    if (customTags) customTags.value = Array.from(bySlug.values()).join(", ");
  }

  function resetTags() {
    setTags([]);
  }

  // ------------------------------------------------------------------
  // Formatting toolbar
  // ------------------------------------------------------------------

  document.querySelectorAll(".md-toolbar button[data-action]").forEach((btn) => {
    const toolbar = btn.closest(".md-toolbar");
    const targetId = toolbar && toolbar.getAttribute("data-target");
    const pair = targetId && editorById[targetId];
    if (!pair) return;

    // Keep the textarea's selection alive: without this the button steals
    // focus on mousedown and the selection is gone by the time we act.
    btn.addEventListener("mousedown", (e) => e.preventDefault());

    btn.addEventListener("click", () => {
      if (document.activeElement !== pair.input && pair.savedSelection) {
        pair.input.focus();
        pair.input.setSelectionRange(pair.savedSelection[0], pair.savedSelection[1]);
      }
      const action = btn.getAttribute("data-action");
      switch (action) {
        case "bold":
          toggleWrap(pair.input, "**");
          break;
        case "italic":
          toggleWrap(pair.input, "*");
          break;
        case "bullet":
        case "number":
        case "heading":
          applyLinePrefix(pair.input, action);
          break;
        default:
          break;
      }
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
          "Importing from a link isn't switched on for this site yet. You can still type the recipe in below."
        );
      }
      if (!res.ok || !data) {
        throw new Error((data && data.error) || "Couldn't import that link.");
      }

      if (nameField) nameField.value = data.name || "";
      setEditorText("ingredients", data.ingredients || "");
      setEditorText("instructions", data.instructions || "");
      setEditorText("notes", data.notes || "");
      // An import never guesses categories — that is the cook's call.

      if (data.photoUrl) {
        photoUrlField.value = data.photoUrl;
        importedPhotoImg.src = data.photoUrl;
        importedPhoto.removeAttribute("hidden");
        hideCurrentPhoto(); // an import supersedes the existing photo preview
      } else {
        clearImportedPhoto();
      }

      importStatus.textContent =
        "Check it over below, then save.";
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
  const formHeading = document.getElementById("form-heading");
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
    formHeading.textContent = "Edit recipe";
    submitBtn.textContent = "Save changes";

    passwordPanel.removeAttribute("hidden");
    const remembered = sessionStorage.getItem(SESSION_KEY);
    if (remembered) passwordField.value = remembered;

    editBanner.textContent = "Loading…";
    editBanner.removeAttribute("hidden");

    try {
      const res = await fetch(`/recipes/${encodeURIComponent(id)}.json`, { cache: "no-cache" });
      if (!res.ok) throw new Error("Couldn't find that recipe.");
      const recipe = await res.json();

      if (nameField) nameField.value = recipe.name || "";
      setEditorText("ingredients", recipe.ingredients || "");
      setEditorText("instructions", recipe.instructions || "");
      setEditorText("notes", recipe.notes || "");
      setTags(recipe.tags);

      if (recipe.photo) {
        currentPhotoImg.src = `/photos/${encodeURIComponent(recipe.photo)}`;
        currentPhoto.removeAttribute("hidden");
        if (removePhotoField) removePhotoField.value = "";
      }

      editBanner.textContent = `Editing "${recipe.name}"`;
    } catch (err) {
      editBanner.textContent =
        (err && err.message) || "Couldn't load that recipe.";
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
    submitBtn.textContent = "Saving…";
    status.textContent = isEditMode ? "Saving your changes…" : "Saving this recipe…";
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
            ? "Saving edits from the site isn't switched on yet."
            : "Saving from the site isn't switched on yet."
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
        status.textContent = "Saved — the page updates in about a minute.";
        status.className = "form-status success";
        submitBtn.textContent = "Saved ✓";
      } else {
        status.textContent = "Saved — it'll appear on the site in about a minute.";
        status.className = "form-status success";
        form.reset();
        resetEditors();
        resetTags();
        photoPreview.style.display = "none";
        clearImportedPhoto();
        if (importUrl) importUrl.value = "";
        if (importStatus) {
          importStatus.textContent = "";
          importStatus.className = "import-status";
        }
        submitBtn.textContent = "Saved ✓";
      }
    } catch (err) {
      status.textContent = (err && err.message) || "Something went wrong. Please try again.";
      status.className = "form-status error";
      submitBtn.disabled = false;
      submitBtn.textContent = isEditMode ? "Save changes" : "Save recipe";
    }
  });
})();
