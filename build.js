// build.js — runs at deploy time on Cloudflare Pages.
//
// It scans recipes/*.json (your source of truth) and regenerates
// recipes/index.json, the manifest the website reads to show and search the
// whole box. This is what makes "edit/delete on the backend" work: add, edit,
// or delete a recipe file, push, and the manifest rebuilds itself — you never
// hand-maintain the list.
//
// It runs with plain Node (no dependencies). Cloudflare's build command is:
//   node build.js

const fs = require("fs");
const path = require("path");

const RECIPES_DIR = path.join(__dirname, "recipes");
const INDEX_FILE = path.join(RECIPES_DIR, "index.json");

function loadRecipes() {
  if (!fs.existsSync(RECIPES_DIR)) {
    fs.mkdirSync(RECIPES_DIR, { recursive: true });
    return [];
  }

  const files = fs
    .readdirSync(RECIPES_DIR)
    .filter((f) => f.endsWith(".json") && f !== "index.json");

  const recipes = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(RECIPES_DIR, file), "utf8");
      const recipe = JSON.parse(raw);
      if (!recipe || !recipe.id || !recipe.name) {
        console.warn(`Skipping ${file}: missing id or name.`);
        continue;
      }
      recipes.push(recipe);
    } catch (err) {
      console.warn(`Skipping unreadable recipe file ${file}: ${err.message}`);
    }
  }

  // Newest first.
  recipes.sort(
    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  );
  return recipes;
}

function main() {
  const recipes = loadRecipes();
  // The manifest carries full text so search works fully client-side.
  fs.writeFileSync(INDEX_FILE, JSON.stringify(recipes, null, 2) + "\n", "utf8");
  console.log(`Built recipes/index.json with ${recipes.length} recipe(s).`);
}

main();
