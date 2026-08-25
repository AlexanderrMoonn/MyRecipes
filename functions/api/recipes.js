// Cloudflare Pages Function — POST /api/recipes
//
// This is the ONLY server-side piece. It lets someone add a recipe from the
// website: it writes a new recipes/<id>.json (and an optional photo) into your
// GitHub repo using the GitHub Contents API. Cloudflare then rebuilds the site
// automatically, the build regenerates recipes/index.json, and the new recipe
// shows up in the box (usually within a minute).
//
// It needs three environment variables, set in the Cloudflare Pages project
// (Settings → Environment variables). GITHUB_TOKEN must be a *secret*:
//
//   GITHUB_TOKEN   a GitHub fine-grained token with "Contents: Read and write"
//                  on this one repo (see README)
//   GITHUB_REPO    "owner/repo", e.g. "AlexanderrMoonn/MyRecipes"
//   GITHUB_BRANCH  branch to commit to, e.g. "main"
//
// The token lives only on Cloudflare's servers and is never sent to browsers.

const ALLOWED_IMAGE_TYPES = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function slugify(text) {
  return String(text)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

function randomSuffix() {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Base64-encode a Uint8Array (for committing binary photo content).
function toBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// Base64-encode a UTF-8 string (for the JSON file content).
function utf8ToBase64(str) {
  return toBase64(new TextEncoder().encode(str));
}

async function githubPutFile(env, path, base64Content, message) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "family-recipes-site",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      message,
      content: base64Content,
      branch: env.GITHUB_BRANCH || "main",
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`GitHub API error (${res.status}): ${detail.slice(0, 300)}`);
  }
  return res.json();
}

export async function onRequestPost({ request, env }) {
  // Make sure the site owner has configured the token/repo.
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return json(
      {
        error:
          "Adding from the site isn't configured. Set GITHUB_TOKEN and GITHUB_REPO in the Cloudflare Pages project (see README).",
      },
      500
    );
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: "Could not read the submitted form." }, 400);
  }

  const name = (formData.get("name") || "").toString().trim();
  const ingredients = (formData.get("ingredients") || "").toString().trim();
  const instructions = (formData.get("instructions") || "").toString().trim();
  const notes = (formData.get("notes") || "").toString().trim();

  if (!name || !ingredients || !instructions) {
    return json(
      { error: "A recipe needs at least a name, ingredients, and instructions." },
      400
    );
  }

  const id = `${slugify(name) || "recipe"}-${randomSuffix()}`;

  // Optional photo.
  let photoFilename = null;
  let photoBase64 = null;
  const photo = formData.get("photo");
  if (photo && typeof photo === "object" && photo.size > 0) {
    const ext = ALLOWED_IMAGE_TYPES[photo.type];
    if (!ext) {
      return json({ error: "Photo must be a JPEG, PNG, WEBP, or GIF image." }, 400);
    }
    if (photo.size > MAX_PHOTO_BYTES) {
      return json({ error: "That photo is too large (5MB max)." }, 400);
    }
    const bytes = new Uint8Array(await photo.arrayBuffer());
    photoBase64 = toBase64(bytes);
    photoFilename = `${id}${ext}`;
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

  try {
    // Commit the photo first (so the JSON never references a missing image).
    if (photoBase64 && photoFilename) {
      await githubPutFile(
        env,
        `photos/${photoFilename}`,
        photoBase64,
        `Add photo for "${name}"`
      );
    }

    await githubPutFile(
      env,
      `recipes/${id}.json`,
      utf8ToBase64(JSON.stringify(recipe, null, 2) + "\n"),
      `Add recipe: ${name}`
    );

    return json(recipe, 201);
  } catch (err) {
    return json(
      { error: "Could not save that recipe. Please try again in a moment." },
      502
    );
  }
}

// Anything other than POST on /api/recipes.
export async function onRequest({ request }) {
  if (request.method === "POST") return; // handled above
  return json({ error: "Not found." }, 404);
}
