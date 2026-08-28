(function () {
  const container = document.getElementById("recipe-container");

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return "";
    }
  }

  function renderRecipe(recipe) {
    document.title = `${recipe.name} — Family Recipes`;

    const photoHtml = recipe.photo
      ? `<img class="photo" src="/photos/${encodeURIComponent(recipe.photo)}" alt="${escapeHtml(recipe.name)}" />`
      : "";

    // These three fields support Markdown. renderMarkdown escapes first, then
    // adds back only a fixed set of safe tags, so this is injection-safe even
    // though anyone can submit a recipe.
    const md = window.renderMarkdown;

    const notesHtml = recipe.notes
      ? `
        <div class="recipe-section notes">
          <h2>Notes</h2>
          <div class="rich-text">${md(recipe.notes)}</div>
        </div>`
      : "";

    container.innerHTML = `
      <article class="recipe-sheet">
        <div class="recipe-actions">
          <a class="btn" href="/add.html?edit=${encodeURIComponent(recipe.id)}">Edit this recipe</a>
        </div>
        ${photoHtml}
        <h1>${escapeHtml(recipe.name)}</h1>
        <p class="meta">Filed ${formatDate(recipe.createdAt)}</p>

        <div class="recipe-section">
          <h2>Ingredients</h2>
          <div class="rich-text">${md(recipe.ingredients)}</div>
        </div>

        <div class="recipe-section">
          <h2>Instructions</h2>
          <div class="rich-text">${md(recipe.instructions)}</div>
        </div>

        ${notesHtml}
      </article>
    `;
  }

  function renderNotFound() {
    container.innerHTML = `
      <div class="state-message">
        <div class="state-title">Couldn't find that recipe</div>
        <p>It may have been removed. <a href="/">Back to the box</a></p>
      </div>`;
  }

  function renderLoadError() {
    container.innerHTML = `
      <div class="state-message">
        <div class="state-title">Couldn't load this recipe</div>
        <p>Refresh the page and try again.</p>
      </div>`;
  }

  // Basic guard: recipe ids are our own slugs (a-z, 0-9, dash). Reject
  // anything else so a weird ?id= can't point the fetch somewhere odd.
  function isValidId(id) {
    return /^[a-z0-9-]+$/.test(id);
  }

  async function load() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    if (!id || !isValidId(id)) return renderNotFound();

    try {
      const res = await fetch(`/recipes/${encodeURIComponent(id)}.json`, {
        cache: "no-cache",
      });
      if (res.status === 404) return renderNotFound();
      if (!res.ok) return renderLoadError();

      const recipe = await res.json();
      renderRecipe(recipe);
    } catch (err) {
      renderLoadError();
    }
  }

  load();
})();
