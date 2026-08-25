// Family Recipes server
// A tiny, dependency-light Express app.
//
// Storage model (by design, per the project spec):
//   data/recipes/<id>.json   -- one file per recipe, human-editable
//   data/photos/<id>.<ext>   -- optional photo for that recipe
//
// There is deliberately NO edit/delete API. Once a recipe is submitted it
// is permanent from the website's point of view. To change or remove a
// recipe, edit or delete its file in data/recipes (and data/photos) directly
// on the server.

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const APP_DIR = __dirname;
const DATA_DIR = path.join(APP_DIR, "data");
const RECIPES_DIR = path.join(DATA_DIR, "recipes");
const PHOTOS_DIR = path.join(DATA_DIR, "photos");
const PUBLIC_DIR = path.join(APP_DIR, "public");

for (const dir of [DATA_DIR, RECIPES_DIR, PHOTOS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const PORT = process.env.PORT || 3000;

const app = express();
app.disable("x-powered-by");

// ---------- static files ----------
app.use(express.static(PUBLIC_DIR));
app.use("/photos", express.static(PHOTOS_DIR, { maxAge: "7d" }));

// ---------- upload handling ----------
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    if (!file) return cb(null, true);
    if (ALLOWED_IMAGE_TYPES.has(file.mimetype)) return cb(null, true);
    // Reject cleanly without throwing, so multer surfaces this as a
    // normal validation failure rather than a stream error.
    cb(new Error("Photo must be a JPEG, PNG, WEBP, or GIF image."));
  },
});

const EXT_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

// ---------- helpers ----------

// Strip anything outside plain ASCII letters/numbers before slugifying.
// This is the piece that was too loose before: names with curly quotes,
// accented letters, or other non-ASCII characters (common when text is
// pasted in from elsewhere, or typed on a phone keyboard) could produce
// slugs multer/Node's file APIs didn't like. Normalizing first fixes that.
function slugify(text) {
  return String(text)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

function makeId(name) {
  const base = slugify(name) || "recipe";
  const suffix = crypto.randomBytes(3).toString("hex");
  return `${base}-${suffix}`;
}

function loadAllRecipes() {
  const files = fs.readdirSync(RECIPES_DIR).filter((f) => f.endsWith(".json"));
  const recipes = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(RECIPES_DIR, file), "utf8");
      const recipe = JSON.parse(raw);
      recipes.push(recipe);
    } catch (err) {
      console.error(`Skipping unreadable recipe file ${file}:`, err.message);
    }
  }
  recipes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return recipes;
}

function toSummary(recipe) {
  return {
    id: recipe.id,
    name: recipe.name,
    photo: recipe.photo || null,
    notes: recipe.notes || "",
    createdAt: recipe.createdAt,
    // a short preview of ingredients for the card
    ingredientsPreview: (recipe.ingredients || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 3),
  };
}

function matchesQuery(recipe, q) {
  if (!q) return true;
  const haystack = [recipe.name, recipe.ingredients, recipe.instructions, recipe.notes]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

// Safe, race-free id/filename generation: if a collision somehow happens
// (astronomically unlikely with the random suffix, but cheap to guard),
// try again with a fresh suffix instead of overwriting an existing recipe.
function reserveId(name) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = makeId(name);
    const jsonPath = path.join(RECIPES_DIR, `${id}.json`);
    if (!fs.existsSync(jsonPath)) return id;
  }
  // Fall back to a fully random id if we somehow kept colliding.
  return crypto.randomUUID();
}

// ---------- API ----------

// List / search recipes
app.get("/api/recipes", (req, res) => {
  const q = (req.query.q || "").toString();
  const recipes = loadAllRecipes().filter((r) => matchesQuery(r, q));
  res.json(recipes.map(toSummary));
});

// Get a single recipe (full detail)
app.get("/api/recipes/:id", (req, res) => {
  const filePath = path.join(RECIPES_DIR, `${req.params.id}.json`);
  if (!filePath.startsWith(RECIPES_DIR) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Recipe not found." });
  }
  try {
    const recipe = JSON.parse(fs.readFileSync(filePath, "utf8"));
    res.json(recipe);
  } catch (err) {
    res.status(500).json({ error: "Could not read that recipe." });
  }
});

// Create a new recipe (no auth, but no update/delete route exists on purpose)
app.post("/api/recipes", (req, res, next) => {
  upload.single("photo")(req, res, (err) => {
    if (err) {
      // Multer/validation errors land here as a normal, readable message
      // instead of crashing the request or falling through to a generic
      // error page.
      const message =
        err.code === "LIMIT_FILE_SIZE"
          ? "That photo is too large (8MB max)."
          : err.message || "Could not process the uploaded photo.";
      return res.status(400).json({ error: message });
    }
    next();
  });
}, (req, res) => {
  try {
    const name = (req.body.name || "").trim();
    const ingredients = (req.body.ingredients || "").trim();
    const instructions = (req.body.instructions || "").trim();
    const notes = (req.body.notes || "").trim();

    if (!name || !ingredients || !instructions) {
      return res.status(400).json({
        error: "A recipe needs at least a name, ingredients, and instructions.",
      });
    }

    const id = reserveId(name);
    let photoFilename = null;

    if (req.file) {
      const ext = EXT_BY_MIME[req.file.mimetype] || "";
      // The filename is always derived from our own generated id, never
      // from the original uploaded filename, so odd characters or emoji
      // in a phone's camera-roll filename can never reach the filesystem.
      photoFilename = `${id}${ext}`;
      fs.writeFileSync(path.join(PHOTOS_DIR, photoFilename), req.file.buffer);
    }

    const recipe = {
      id,
      name,
      ingredients,
      instructions,
      notes,
      photo: photoFilename,
      createdAt: new Date().toISOString(),
    };

    fs.writeFileSync(
      path.join(RECIPES_DIR, `${id}.json`),
      JSON.stringify(recipe, null, 2),
      "utf8"
    );

    res.status(201).json(recipe);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not save that recipe. Please try again." });
  }
});

// Unknown API routes -> clean JSON 404 instead of an HTML error page
// (an HTML response here is what previously made the frontend's
// res.json() call blow up with a cryptic parsing error).
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found." });
});

// Generic error handler, always returns JSON
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err.message || "Something went wrong." });
});

app.listen(PORT, () => {
  console.log(`Family Recipes listening on http://localhost:${PORT}`);
  console.log(`Recipes stored in: ${RECIPES_DIR}`);
  console.log(`Photos stored in:  ${PHOTOS_DIR}`);
});
