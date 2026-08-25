(function () {
  const catalog = document.getElementById("catalog");
  const searchInput = document.getElementById("search-input");
  const searchMeta = document.getElementById("search-meta");

  let debounceTimer = null;

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

  function renderCard(recipe) {
    const thumb = recipe.photo
      ? `<img class="thumb" src="/photos/${encodeURIComponent(recipe.photo)}" alt="${escapeHtml(recipe.name)}" loading="lazy" />`
      : `<div class="thumb placeholder" aria-hidden="true">${escapeHtml(initials(recipe.name))}</div>`;

    const previewItems = (recipe.ingredientsPreview || [])
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

  async function loadRecipes(query) {
    catalog.setAttribute("aria-busy", "true");
    try {
      const url = "/api/recipes" + (query ? `?q=${encodeURIComponent(query)}` : "");
      const res = await fetch(url);
      const contentType = res.headers.get("content-type") || "";
      if (!res.ok || !contentType.includes("application/json")) {
        throw new Error("Unexpected response from server");
      }
      const recipes = await res.json();

      if (!recipes.length) {
        renderEmpty(query);
      } else {
        catalog.innerHTML = recipes.map(renderCard).join("");
      }

      searchMeta.textContent = query
        ? `${recipes.length} recipe${recipes.length === 1 ? "" : "s"} found`
        : `${recipes.length} recipe${recipes.length === 1 ? "" : "s"} in the box`;
    } catch (err) {
      catalog.innerHTML = `
        <div class="state-message" style="grid-column: 1 / -1;">
          <div class="state-title">Couldn't load recipes</div>
          <p>Check that the server is running and try refreshing the page.</p>
        </div>`;
      searchMeta.textContent = "";
    } finally {
      catalog.removeAttribute("aria-busy");
    }
  }

  searchInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      loadRecipes(searchInput.value.trim());
    }, 200);
  });

  // load query from URL if present (e.g. shared search link)
  const params = new URLSearchParams(window.location.search);
  const initialQuery = params.get("q") || "";
  if (initialQuery) searchInput.value = initialQuery;

  loadRecipes(initialQuery);
})();
