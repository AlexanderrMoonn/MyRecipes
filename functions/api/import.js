// Cloudflare Pages Function — POST /api/import
//
// The "Preview" step of link import. It fetches a recipe URL, extracts the
// recipe, and returns it as JSON for the add form to fill in. It does NOT
// commit anything — publishing happens later through /api/recipes, after the
// user has reviewed and edited.
//
// Extraction strategy, best-effort and biased toward the big recipe sites:
//   1. schema.org JSON-LD  <script type="application/ld+json"> Recipe  (best)
//   2. microdata itemtype  ...schema.org/Recipe                        (fallback)
// Most major sites (AllRecipes, NYT Cooking, Serious Eats, Food Network, Bon
// Appétit, King Arthur, Sally's Baking, etc.) ship JSON-LD for Google, so #1
// handles the large majority. If neither is found, it returns a clear error.
//
// Output shape (matches the add form fields):
//   { name, ingredients, instructions, notes: "", photoUrl, sourceUrl }
// - ingredients: markdown bullet list, ingredient groups preserved as **subheads**
// - instructions: numbered list with the number bolded, e.g. "**1.** Preheat…"
// - notes: always empty (we intentionally skip notes/FAQ/comments/story)

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// ---- tiny HTML entity + tag helpers -------------------------------------

function decodeEntities(str) {
  if (!str) return "";
  return String(str)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function stripTags(html) {
  if (!html) return "";
  return decodeEntities(
    String(html)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|div|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function cleanLine(s) {
  return decodeEntities(String(s || ""))
    .replace(/\s+/g, " ")
    .trim();
}

// ---- name cleanup --------------------------------------------------------

// Trim common marketing lead-ins so "How to Make the Best Baked Apple Cider
// Donuts (Easy!)" becomes "Baked Apple Cider Donuts". Conservative on purpose:
// we'd rather leave a name slightly long than butcher a real dish name. The
// user reviews it in the form anyway.
function cleanName(raw) {
  let name = cleanLine(raw);
  if (!name) return "";

  // Drop trailing "| Site Name" or "- Site Name" or "— Site Name".
  name = name.replace(/\s*[|\u2013\u2014-]\s*[^|\u2013\u2014-]{1,40}$/,(m)=>{
    // Only strip if the tail looks like a site/section, not part of the dish.
    // Heuristic: strip when the tail has no spaces or is a known-ish suffix.
    return "";
  });

  // Remove leading "Recipe:" style prefixes.
  name = name.replace(/^\s*recipe\s*[:\-]\s*/i, "");

  // Strip common lead-in phrases at the very start.
  const leadins = [
    /^how to make\s+/i,
    /^how to bake\s+/i,
    /^how to cook\s+/i,
    /^the best\s+/i,
    /^best[- ]ever\s+/i,
    /^easy\s+/i,
    /^quick\s+/i,
    /^simple\s+/i,
    /^homemade\s+/i,
    /^my favorite\s+/i,
    /^the perfect\s+/i,
    /^perfect\s+/i,
    /^ultimate\s+/i,
    /^the ultimate\s+/i,
    /^classic\s+/i,
    /^delicious\s+/i,
    /^amazing\s+/i,
  ];
  // Apply repeatedly so "The Best Easy Homemade X" collapses to "X".
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 6) {
    changed = false;
    for (const re of leadins) {
      if (re.test(name)) {
        name = name.replace(re, "");
        changed = true;
      }
    }
  }

  // Trim a trailing parenthetical tagline like "(So Easy!)" or "(Video)".
  name = name.replace(/\s*\((?:so\s+)?(?:easy|quick|video|gluten[- ]free|vegan|recipe)[^)]*\)\s*$/i, "");

  // Remove a trailing "Recipe" word ("Apple Cider Donuts Recipe").
  name = name.replace(/\s+recipe$/i, "");

  return name.trim() || cleanLine(raw);
}

// ---- JSON-LD extraction --------------------------------------------------

function collectJsonLdBlocks(html) {
  const blocks = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const text = m[1].trim();
    try {
      blocks.push(JSON.parse(text));
    } catch {
      // Some sites emit multiple JSON objects or trailing commas; try a
      // light repair: grab the first {...} balanced-ish chunk.
      try {
        const cleaned = text
          .replace(/^\uFEFF/, "")
          .replace(/,\s*([}\]])/g, "$1");
        blocks.push(JSON.parse(cleaned));
      } catch {
        /* skip unparseable block */
      }
    }
  }
  return blocks;
}

// Walk a JSON-LD value (object / array / @graph) to find a Recipe node.
function findRecipeNode(node, seen = new Set()) {
  if (!node || typeof node !== "object") return null;
  if (seen.has(node)) return null;
  seen.add(node);

  const type = node["@type"];
  const isRecipe = Array.isArray(type)
    ? type.some((t) => String(t).toLowerCase() === "recipe")
    : String(type || "").toLowerCase() === "recipe";
  if (isRecipe) return node;

  if (Array.isArray(node["@graph"])) {
    for (const child of node["@graph"]) {
      const found = findRecipeNode(child, seen);
      if (found) return found;
    }
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findRecipeNode(child, seen);
      if (found) return found;
    }
  }
  return null;
}

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

// recipeIngredient is a flat array of strings on schema.org — no grouping.
// Some sites use recipeIngredient with heading lines mixed in; we keep order.
function ingredientsFromNode(node) {
  const list = asArray(node.recipeIngredient).length
    ? asArray(node.recipeIngredient)
    : asArray(node.ingredients);
  return list.map((x) => cleanLine(typeof x === "string" ? x : x && x.name)).filter(Boolean);
}

// recipeInstructions can be: string, array of strings, array of HowToStep,
// or array of HowToSection (each with itemListElement of HowToStep). We keep
// section headings as bold subheads and number steps within the whole recipe.
function instructionsFromNode(node) {
  const out = []; // array of {heading?:true, text}
  const raw = node.recipeInstructions;

  function pushStep(text) {
    const t = cleanLine(stripTags(text));
    if (t) out.push({ text: t });
  }

  function handle(item) {
    if (item == null) return;
    if (typeof item === "string") {
      // A big string may contain newlines: split into sentences/lines.
      const parts = stripTags(item)
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length > 1) parts.forEach(pushStep);
      else pushStep(item);
      return;
    }
    const t = String(item["@type"] || "").toLowerCase();
    if (t === "howtosection") {
      const heading = cleanLine(item.name || "");
      if (heading) out.push({ heading: true, text: heading });
      asArray(item.itemListElement).forEach(handle);
    } else if (t === "howtostep" || item.text || item.name) {
      pushStep(item.text || item.name);
    } else if (Array.isArray(item)) {
      item.forEach(handle);
    }
  }

  if (typeof raw === "string") handle(raw);
  else asArray(raw).forEach(handle);

  return out;
}

function imageFromNode(node) {
  const img = node.image;
  if (!img) return "";
  if (typeof img === "string") return img;
  if (Array.isArray(img)) {
    const first = img[0];
    return typeof first === "string" ? first : (first && first.url) || "";
  }
  return img.url || "";
}

// ---- format to the add form's markdown -----------------------------------

function formatIngredients(list) {
  // schema.org gives a flat list; keep order, one bullet each.
  return list.map((line) => `- ${line}`).join("\n");
}

function formatInstructions(steps) {
  const lines = [];
  let n = 0;
  for (const s of steps) {
    if (s.heading) {
      if (lines.length) lines.push(""); // blank line before a new section
      lines.push(`## ${s.text}`);
    } else {
      n += 1;
      lines.push(`**${n}.** ${s.text}`);
    }
  }
  return lines.join("\n");
}

// ---- main ----------------------------------------------------------------

export async function onRequestPost({ request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Send a JSON body with a url." }, 400);
  }

  const url = (body && body.url ? String(body.url) : "").trim();
  if (!/^https?:\/\//i.test(url)) {
    return json({ error: "Please paste a full http(s) link to the recipe." }, 400);
  }

  let html;
  try {
    const res = await fetch(url, {
      headers: {
        // Some sites gate on a browsery UA; be a polite, honest bot.
        "User-Agent":
          "Mozilla/5.0 (compatible; FamilyRecipesImporter/1.0; +https://recipes.moonlanding.app)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      return json(
        { error: `Couldn't fetch that page (site said ${res.status}). It may block importers or require a login.` },
        502
      );
    }
    html = await res.text();
  } catch (err) {
    return json(
      { error: "Couldn't reach that page. Check the link and try again." },
      502
    );
  }

  const blocks = collectJsonLdBlocks(html);
  let recipeNode = null;
  for (const b of blocks) {
    recipeNode = findRecipeNode(b);
    if (recipeNode) break;
  }

  if (!recipeNode) {
    return json(
      {
        error:
          "Couldn't find a recipe on that page. This works best on major recipe sites (AllRecipes, NYT Cooking, Serious Eats, etc.). You can still add it by hand.",
      },
      422
    );
  }

  const name = cleanName(recipeNode.name || "");
  const ingredientList = ingredientsFromNode(recipeNode);
  const steps = instructionsFromNode(recipeNode);

  if (!ingredientList.length || !steps.length) {
    return json(
      {
        error:
          "Found a recipe but couldn't read its ingredients or steps cleanly. You can still add it by hand.",
      },
      422
    );
  }

  let photoUrl = imageFromNode(recipeNode);
  // Resolve protocol-relative or relative image URLs against the page.
  try {
    if (photoUrl) photoUrl = new URL(photoUrl, url).href;
  } catch {
    photoUrl = "";
  }

  return json({
    name,
    ingredients: formatIngredients(ingredientList),
    instructions: formatInstructions(steps),
    notes: "", // intentionally skip notes/FAQ/comments/story
    photoUrl,
    sourceUrl: url,
  });
}

export async function onRequest({ request }) {
  if (request.method === "POST") return;
  return json({ error: "Not found." }, 404);
}
