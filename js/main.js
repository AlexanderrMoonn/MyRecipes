(function () {
  const catalog = document.getElementById("catalog");
  const searchInput = document.getElementById("search-input");
  const searchMeta = document.getElementById("search-meta");

  let debounceTimer = null;
  let allRecipes = []; // full manifest, loaded once, searched client-side

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function initials(name) {
    return (name || "?")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join("");
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return "";
    }
  }

  // Build a short ingredient preview (first 3 lines) from the full text.
  function ingredientsPreview(text) {
    return (text || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 3);
  }

  function matchesQuery(recipe, q) {
    if (!q) return true;
    const haystack = [
      recipe.name,
      recipe.ingredients,
      recipe.instructions,
      recipe.notes,
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
    return q
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .every((term) => haystack.includes(term));
  }

  function renderCard(recipe) {
    const thumb = recipe.photo
      ? `<img class="thumb" src="/photos/${encodeURIComponent(recipe.photo)}" alt="${escapeHtml(recipe.name)}" loading="lazy" />`
      : `<div class="thumb placeholder" aria-hidden="true">${escapeHtml(initials(recipe.name))}</div>`;

    const previewItems = ingredientsPreview(recipe.ingredients)
      .map((line) => `<li>${escapeHtml(line)}</li>`)
      .join("");

    return `
      <a class="recipe-card" href="/recipe.html?id=${encodeURIComponent(recipe.id)}">
        <span class="pin" aria-hidden="true"></span>
        ${thumb}
        <h3>${escapeHtml(recipe.name)}</h3>
        <ul class="preview">${previewItems}</ul>
        <span class="date">Filed ${formatDate(recipe.createdAt)}</span>
      </a>
    `;
  }

  function renderEmpty(query) {
    if (query) {
      catalog.innerHTML = `
        <div class="state-message" style="grid-column: 1 / -1;">
          <div class="state-title">No recipes match "${escapeHtml(query)}"</div>
          <p>Try a different search, or <a href="/add.html">add this recipe</a> to the box.</p>
        </div>`;
    } else {
      catalog.innerHTML = `
        <div class="state-message" style="grid-column: 1 / -1;">
          <div class="state-title">The box is empty</div>
          <p><a href="/add.html">Add your first recipe</a> to get started.</p>
        </div>`;
    }
  }

  function render(query) {
    const results = allRecipes.filter((r) => matchesQuery(r, query));
    if (!results.length) {
      renderEmpty(query);
    } else {
      catalog.innerHTML = results.map(renderCard).join("");
    }
    searchMeta.textContent = query
      ? `${results.length} recipe${results.length === 1 ? "" : "s"} found`
      : `${results.length} recipe${results.length === 1 ? "" : "s"} in the box`;
  }

  async function loadManifest() {
    catalog.setAttribute("aria-busy", "true");
    try {
      // Static manifest generated at build time from recipes/*.json.
      // Cache-bust so a freshly rebuilt site doesn't serve a stale list.
      const res = await fetch("/recipes/index.json", { cache: "no-cache" });
      if (!res.ok) throw new Error("Could not load the recipe list.");
      const data = await res.json();
      allRecipes = Array.isArray(data) ? data : [];
      // Newest first (build step already sorts, but be safe).
      allRecipes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      const params = new URLSearchParams(window.location.search);
      const initialQuery = params.get("q") || "";
      if (initialQuery) searchInput.value = initialQuery;
      render(initialQuery.trim());
    } catch (err) {
      catalog.innerHTML = `
        <div class="state-message" style="grid-column: 1 / -1;">
          <div class="state-title">Couldn't load recipes</div>
          <p>Refresh the page in a moment. If this is a brand-new site, the recipe box may still be building.</p>
        </div>`;
      searchMeta.textContent = "";
    } finally {
      catalog.removeAttribute("aria-busy");
    }
  }

  searchInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      render(searchInput.value.trim());
    }, 150);
  });

  loadManifest();
})();
