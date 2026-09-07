// main.js — the recipe list on the home page.
//
// The whole manifest is loaded once and filtered in the browser, so
// switching categories and typing in the search box are both instant. The
// category and query both live in the URL (?tag=desserts&q=lemon) so any
// view you are looking at is a link you can send to someone.

(function () {
  const S = window.Site;

  const catalog = document.getElementById("catalog");
  const searchInput = document.getElementById("search-input");
  const listTitle = document.getElementById("list-title");
  const listCount = document.getElementById("list-count");

  let allRecipes = [];
  let activeTag = "";
  let query = "";
  let debounceTimer = null;

  function initial(name) {
    const first = String(name || "?").trim()[0];
    return (first || "?").toUpperCase();
  }

  function matchesQuery(recipe, q) {
    if (!q) return true;
    const haystack = [recipe.name, recipe.ingredients, recipe.instructions, recipe.notes]
      .concat(S.tagsOf(recipe))
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
    return q
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .every((term) => haystack.includes(term));
  }

  // The label for a category slug, taken from the recipes that carry it, so
  // "no-bake" in the URL shows up as the "No-Bake" the writer actually typed.
  function labelForSlug(slug) {
    for (const recipe of allRecipes) {
      for (const tag of S.tagsOf(recipe)) {
        if (S.slugify(tag) === slug) return tag;
      }
    }
    return slug.replace(/-/g, " ");
  }

  function renderCard(recipe) {
    const thumb = recipe.photo
      ? `<img class="thumb" src="/photos/${encodeURIComponent(recipe.photo)}" alt="" loading="lazy" />`
      : `<div class="thumb placeholder" aria-hidden="true">${S.escapeHtml(initial(recipe.name))}</div>`;

    const tags = S.tagsOf(recipe);
    const tagLine = tags.length
      ? `<p class="card-tags">${S.escapeHtml(tags.join(" · "))}</p>`
      : "";

    return `
      <a class="recipe-card" href="/recipe.html?id=${encodeURIComponent(recipe.id)}">
        ${thumb}
        <div class="card-body">
          <h3>${S.escapeHtml(recipe.name)}</h3>
          ${tagLine}
          <span class="card-date">Added ${S.escapeHtml(S.formatDate(recipe.createdAt))}</span>
        </div>
      </a>`;
  }

  function renderEmpty() {
    if (query) {
      catalog.innerHTML = `
        <div class="state-message">
          <div class="state-title">Nothing matches "${S.escapeHtml(query)}"</div>
          <p>Try a shorter search, or <a href="/add.html">add this recipe</a>.</p>
        </div>`;
    } else if (activeTag) {
      catalog.innerHTML = `
        <div class="state-message">
          <div class="state-title">Nothing here yet</div>
          <p>No recipes are tagged ${S.escapeHtml(labelForSlug(activeTag))}. <a href="/">See all recipes</a>.</p>
        </div>`;
    } else {
      catalog.innerHTML = `
        <div class="state-message">
          <div class="state-title">No recipes yet</div>
          <p><a href="/add.html">Add the first one</a> to get started.</p>
        </div>`;
    }
  }

  function render() {
    const results = allRecipes.filter(
      (recipe) => S.hasTag(recipe, activeTag) && matchesQuery(recipe, query)
    );

    listTitle.textContent = activeTag ? labelForSlug(activeTag) : "All recipes";
    document.title = activeTag
      ? `${labelForSlug(activeTag)} — Family Recipes`
      : "Family Recipes";

    if (!results.length) {
      renderEmpty();
      listCount.textContent = "";
      return;
    }

    catalog.innerHTML = results.map(renderCard).join("");
    listCount.textContent = `${results.length} recipe${results.length === 1 ? "" : "s"}`;
  }

  // Keep the address bar in step with what is on screen, without pushing a
  // history entry for every keystroke.
  function syncUrl() {
    const params = new URLSearchParams();
    if (activeTag) params.set("tag", activeTag);
    if (query) params.set("q", query);
    const search = params.toString();
    history.replaceState(null, "", search ? `/?${search}` : "/");
  }

  function readUrl() {
    const params = new URLSearchParams(window.location.search);
    activeTag = S.slugify(params.get("tag") || "");
    query = (params.get("q") || "").trim();
  }

  searchInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      query = searchInput.value.trim();
      render();
      syncUrl();
    }, 150);
  });

  readUrl();
  if (query) searchInput.value = query;
  S.renderCategoryNav(activeTag);

  S.loadManifest()
    .then((recipes) => {
      allRecipes = recipes.slice().sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      );
      render();
    })
    .catch(() => {
      catalog.innerHTML = `
        <div class="state-message">
          <div class="state-title">Couldn't load the recipes</div>
          <p>Refresh in a moment. If a recipe was just added, the site may still be rebuilding.</p>
        </div>`;
      listCount.textContent = "";
    });
})();
