// site.js — the handful of things every page needs.
//
// Loaded first on every page, before the page's own script. It owns the
// category list, the shared text helpers that used to be copy-pasted into
// each file, and one cached fetch of the recipe manifest so a page that
// needs the list twice (the grid and the footer, say) only asks once.

(function () {
  // The categories that get their own button in the header. A recipe can
  // carry any tag at all, but only these steer the nav — otherwise one
  // stray tag would push a button onto everyone's header forever.
  const CATEGORIES = [
    "Breakfast",
    "Dinner",
    "Sides",
    "Snacks",
    "Desserts",
    "Baking",
    "No-Bake",
    "Drinks",
  ];

  const MAX_TAGS = 8;
  const MAX_TAG_LENGTH = 24;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Tags are stored with their capitalisation intact ("No-Bake", "Grandma's")
  // so they read well, and compared by this slug so "no-bake", "No Bake" and
  // "NO-BAKE" all land in the same place.
  function slugify(text) {
    return String(text || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }

  // Clean a list of tags from anywhere (a form, a JSON file, a URL): trim
  // them, drop blanks and duplicates, and keep the list to a sane size.
  function normalizeTags(list) {
    const out = [];
    const seen = new Set();
    (Array.isArray(list) ? list : []).forEach((raw) => {
      const tag = String(raw || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_TAG_LENGTH);
      const slug = slugify(tag);
      if (!slug || seen.has(slug) || out.length >= MAX_TAGS) return;
      seen.add(slug);
      out.push(tag);
    });
    return out;
  }

  function tagsOf(recipe) {
    return normalizeTags(recipe && recipe.tags);
  }

  function hasTag(recipe, slug) {
    if (!slug) return true;
    return tagsOf(recipe).some((tag) => slugify(tag) === slug);
  }

  function formatDate(iso, style) {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: style === "long" ? "long" : "short",
        day: "numeric",
      });
    } catch {
      return "";
    }
  }

  function tagUrl(tag) {
    return "/?tag=" + encodeURIComponent(slugify(tag));
  }

  // One fetch per page load, shared by whoever asks. Resolves to [] rather
  // than rejecting for callers that only want to decorate the page.
  let manifestPromise = null;
  function loadManifest() {
    if (!manifestPromise) {
      manifestPromise = fetch("/recipes/index.json", { cache: "no-cache" })
        .then((res) => {
          if (!res.ok) throw new Error("Could not load the recipe list.");
          return res.json();
        })
        .then((data) => (Array.isArray(data) ? data : []));
    }
    return manifestPromise;
  }

  // Fill in the header's category bar. Only categories that actually have a
  // recipe get a button — an empty "Breakfast" that leads to an empty page
  // is worse than no button at all.
  //
  // activeSlug marks one button as the page you are on: "" is All recipes,
  // a slug is that category, and null (a recipe or the add form) marks none.
  function renderCategoryNav(activeSlug) {
    const nav = document.getElementById("category-nav");
    if (!nav) return Promise.resolve();
    const bar = nav.closest(".category-bar");

    // An empty bar must take up no room at all — hiding just the <nav>
    // would leave its container's border and background as a bare stripe.
    function hideBar() {
      nav.innerHTML = "";
      nav.hidden = true;
      if (bar) bar.hidden = true;
    }

    return loadManifest()
      .then((recipes) => {
        const counts = new Map();
        recipes.forEach((recipe) => {
          tagsOf(recipe).forEach((tag) => {
            const slug = slugify(tag);
            counts.set(slug, (counts.get(slug) || 0) + 1);
          });
        });

        const links = [{ label: "All recipes", slug: "" }].concat(
          CATEGORIES.filter((label) => counts.get(slugify(label))).map((label) => ({
            label,
            slug: slugify(label),
          }))
        );

        // A lone "All recipes" button is just a label; leave the bar out.
        if (links.length < 2) {
          hideBar();
          return;
        }

        nav.hidden = false;
        if (bar) bar.hidden = false;
        nav.innerHTML = links
          .map((link) => {
            const current = activeSlug != null && activeSlug === link.slug;
            return (
              `<a class="category-link${current ? " is-current" : ""}"` +
              (current ? ' aria-current="page"' : "") +
              ` href="${link.slug ? "/?tag=" + encodeURIComponent(link.slug) : "/"}">` +
              escapeHtml(link.label) +
              `</a>`
            );
          })
          .join("");
      })
      .catch(hideBar);
  }

  window.Site = {
    CATEGORIES,
    MAX_TAGS,
    MAX_TAG_LENGTH,
    escapeHtml,
    slugify,
    normalizeTags,
    tagsOf,
    hasTag,
    formatDate,
    tagUrl,
    loadManifest,
    renderCategoryNav,
  };
})();
