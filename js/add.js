(function () {
  const form = document.getElementById("recipe-form");
  const status = document.getElementById("form-status");
  const submitBtn = document.getElementById("submit-btn");
  const photoInput = document.getElementById("photo");
  const photoPreview = document.getElementById("photo-preview");
  const photoPreviewImg = document.getElementById("photo-preview-img");

  const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB (GitHub-friendly, base64 fits comfortably)

  // ---------- Markdown toolbar + live preview ----------

  const previewEl = document.getElementById("recipe-preview");
  const previewToggle = document.getElementById("preview-toggle");

  // Wrap or prefix the current selection in a textarea with Markdown syntax.
  function applyMarkdown(textarea, kind) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    const selected = value.slice(start, end);

    let before = value.slice(0, start);
    let after = value.slice(end);
    let inserted;
    let selOffset = 0; // where to place the cursor inside the inserted text

    if (kind === "bold" || kind === "italic") {
      const marker = kind === "bold" ? "**" : "*";
      const text = selected || (kind === "bold" ? "bold text" : "italic text");
      inserted = marker + text + marker;
      selOffset = marker.length;
    } else if (kind === "h2") {
      // Operate on whole lines: ensure the line starts with "## ".
      const lineStart = before.lastIndexOf("\n") + 1;
      const linePrefix = value.slice(lineStart, start);
      before = value.slice(0, lineStart);
      const rest = linePrefix + selected;
      inserted = "## " + rest.replace(/^#{1,3}\s*/, "");
      after = value.slice(end);
      textarea.value = before + inserted + after;
      const pos = before.length + inserted.length;
      textarea.setSelectionRange(pos, pos);
      textarea.focus();
      updatePreview();
      return;
    } else if (kind === "ul" || kind === "ol") {
      const block = selected || "item";
      const lines = block.split("\n");
      inserted = lines
        .map((l, i) => (kind === "ul" ? "- " : `${i + 1}. `) + l)
        .join("\n");
    } else {
      return;
    }

    textarea.value = before + inserted + after;
    if (selected) {
      textarea.setSelectionRange(before.length, before.length + inserted.length);
    } else {
      // put cursor inside the markers / on the placeholder
      textarea.setSelectionRange(
        before.length + selOffset,
        before.length + inserted.length - selOffset
      );
    }
    textarea.focus();
    updatePreview();
  }

  document.querySelectorAll(".md-toolbar").forEach((bar) => {
    const targetId = bar.getAttribute("data-target");
    const textarea = document.getElementById(targetId);
    if (!textarea) return;
    bar.querySelectorAll(".md-btn").forEach((btn) => {
      btn.addEventListener("click", () => applyMarkdown(textarea, btn.dataset.md));
    });
    // Ctrl/Cmd+B and Ctrl/Cmd+I shortcuts
    textarea.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "b") {
        e.preventDefault();
        applyMarkdown(textarea, "bold");
      } else if (k === "i") {
        e.preventDefault();
        applyMarkdown(textarea, "italic");
      }
    });
    textarea.addEventListener("input", updatePreview);
  });

  const nameInput = document.getElementById("name");
  if (nameInput) nameInput.addEventListener("input", updatePreview);

  function updatePreview() {
    if (!previewEl) return;
    const md = window.renderMarkdown;
    const name = (nameInput && nameInput.value.trim()) || "Recipe name";
    const ingredients = document.getElementById("ingredients").value.trim();
    const instructions = document.getElementById("instructions").value.trim();
    const notes = document.getElementById("notes").value.trim();

    function esc(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    let html = `<h1>${esc(name)}</h1>`;
    html += `<div class="recipe-section"><h2>Ingredients</h2><div class="rich-text">${
      ingredients ? md(ingredients) : '<p class="preview-empty">—</p>'
    }</div></div>`;
    html += `<div class="recipe-section"><h2>Instructions</h2><div class="rich-text">${
      instructions ? md(instructions) : '<p class="preview-empty">—</p>'
    }</div></div>`;
    if (notes) {
      html += `<div class="recipe-section notes"><h2>Notes</h2><div class="rich-text">${md(
        notes
      )}</div></div>`;
    }
    previewEl.innerHTML = html;
  }

  if (previewToggle) {
    previewToggle.addEventListener("click", () => {
      const hidden = previewEl.hasAttribute("hidden");
      if (hidden) {
        previewEl.removeAttribute("hidden");
        previewToggle.textContent = "Hide";
        previewToggle.setAttribute("aria-expanded", "true");
      } else {
        previewEl.setAttribute("hidden", "");
        previewToggle.textContent = "Show";
        previewToggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  updatePreview();

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

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    status.textContent = "";
    status.className = "form-status";

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

      // If the add-on-site function isn't configured yet, the request 404s
      // (no /api route) or returns a config error. Give a clear message
      // instead of a cryptic parse failure.
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
      photoPreview.style.display = "none";
      updatePreview();
      submitBtn.textContent = "Filed ✓";
      // Leave the button disabled so the same recipe isn't double-filed.
    } catch (err) {
      status.textContent = (err && err.message) || "Something went wrong. Please try again.";
      status.className = "form-status error";
      submitBtn.disabled = false;
      submitBtn.textContent = "File this recipe";
    }
  });
})();
