// footer.js — a quiet line at the bottom of every page.

(function () {
  const S = window.Site;
  const footer = document.getElementById("site-footer");
  if (!footer) return;

  function render(left, right) {
    footer.innerHTML = `<div class="wrap"><span>${left}</span><span>${right}</span></div>`;
  }

  S.loadManifest()
    .then((recipes) => {
      if (!recipes.length) {
        render("Family Recipes", "");
        return;
      }
      // The manifest is newest-first, so the first entry is the latest.
      const last = recipes[0];
      const latest =
        `Newest: <a href="/recipe.html?id=${encodeURIComponent(last.id)}">` +
        `${S.escapeHtml(last.name)}</a>, ${S.escapeHtml(S.formatDate(last.createdAt))}`;
      render("Family Recipes", latest);
    })
    .catch(() => {
      // Fail quietly — the footer is a nice-to-have, not critical.
      render("Family Recipes", "");
    });
})();
