(function () {
  const footer = document.getElementById("site-footer");
  if (!footer) return;

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
        month: "short",
        day: "numeric",
      });
    } catch {
      return "";
    }
  }

  async function loadLastRecipe() {
    try {
      const res = await fetch("/recipes/index.json", { cache: "no-cache" });
      if (!res.ok) throw new Error("Unexpected response");

      const recipes = await res.json();
      if (!Array.isArray(recipes) || recipes.length === 0) {
        footer.textContent = "No recipes added yet";
        return;
      }

      // The manifest is newest-first, so the first entry is the latest.
      const last = recipes[0];
      footer.innerHTML = `Last recipe added, ${formatDate(last.createdAt)} &ndash; <a class="last-recipe-link" href="/recipe.html?id=${encodeURIComponent(last.id)}">${escapeHtml(last.name)}</a>`;
    } catch (err) {
      // Fail quietly — the footer is a nice-to-have, not critical.
      footer.textContent = "";
    }
  }

  loadLastRecipe();
})();
