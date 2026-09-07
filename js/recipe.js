// recipe.js — one recipe, laid out to cook from.
//
// Ingredients sit in a column of their own that stays put while you scroll
// the method beside it, and collapse above the steps on a phone.

(function () {
  const S = window.Site;
  const container = document.getElementById("recipe-container");

  function tagListHtml(tags) {
    if (!tags.length) return "";
    return (
      `<ul class="tag-list">` +
      tags
        .map(
          (tag) =>
            `<li><a class="tag" href="${S.tagUrl(tag)}">${S.escapeHtml(tag)}</a></li>`
        )
        .join("") +
      `</ul>`
    );
  }

  function renderRecipe(recipe) {
    document.title = `${recipe.name} — Family Recipes`;

    // These three fields support Markdown. renderMarkdown escapes first, then
    // adds back only a fixed set of safe tags, so this is injection-safe even
    // though anyone can submit a recipe.
    const md = window.renderMarkdown;
    const tags = S.tagsOf(recipe);

    const photoHtml = recipe.photo
      ? `<img class="recipe-photo" src="/photos/${encodeURIComponent(recipe.photo)}" alt="${S.escapeHtml(recipe.name)}" />`
      : "";

    const notesHtml = recipe.notes
      ? `
          <section class="recipe-section notes">
            <h2>Notes</h2>
            <div class="rich-text">${md(recipe.notes)}</div>
          </section>`
      : "";

    const added = S.formatDate(recipe.createdAt, "long");
    const updated = recipe.updatedAt ? S.formatDate(recipe.updatedAt, "long") : "";
    const dateLine =
      updated && updated !== added
        ? `Added ${S.escapeHtml(added)} · Updated ${S.escapeHtml(updated)}`
        : `Added ${S.escapeHtml(added)}`;

    container.innerHTML = `
      <article class="recipe-sheet">
        ${photoHtml}
        <header class="recipe-head">
          <h1>${S.escapeHtml(recipe.name)}</h1>
          ${tagListHtml(tags)}
          <div class="recipe-meta">
            <span>${dateLine}</span>
            <span class="recipe-actions">
              <button type="button" class="btn" id="print-btn">Print</button>
              <a class="btn" href="/add.html?edit=${encodeURIComponent(recipe.id)}">Edit</a>
            </span>
          </div>
        </header>

        <div class="recipe-body">
          <section class="recipe-section ingredients">
            <h2>Ingredients</h2>
            <div class="rich-text">${md(recipe.ingredients)}</div>
          </section>

          <section class="recipe-section">
            <h2>Instructions</h2>
            <div class="rich-text">${md(recipe.instructions)}</div>
          </section>

          ${notesHtml}
        </div>
      </article>`;

    const printBtn = document.getElementById("print-btn");
    if (printBtn) printBtn.addEventListener("click", () => window.print());
  }

  function renderNotFound() {
    container.innerHTML = `
      <div class="state-message">
        <div class="state-title">Couldn't find that recipe</div>
        <p>It may have been removed. <a href="/">See all recipes</a></p>
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

  S.renderCategoryNav(null);
  load();
})();
