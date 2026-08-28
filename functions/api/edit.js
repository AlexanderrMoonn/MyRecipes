// Cloudflare Pages Function — POST /api/edit
//
// Updates an existing recipes/<id>.json (and its photo, if changed) in your
// GitHub repo. Place this file next to recipes.js and import.js, at
// functions/api/edit.js — Cloudflare Pages routes it to /api/edit
// automatically based on that path.
//
// The shared family password is checked HERE, on the server, against the
// EDIT_PASSWORD secret. It is never written into any file the browser can
// load, and the browser never learns the correct value — only whether the
// one it sent matched.
//
// Needs the same three environment variables as /api/recipes:
//   GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH
// plus one more, set as a *secret* the same way as GITHUB_TOKEN
// (Cloudflare Pages → your project → Settings → Environment variables):
//   EDIT_PASSWORD   the shared password required to save an edit

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

function isValidId(id) {
  return /^[a-z0-9-]+$/.test(id);
}

function toBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function utf8ToBase64(str) {
  return toBase64(new TextEncoder().encode(str));
}

function base64ToUtf8(b64) {
  const binary = atob(String(b64).replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// Constant-time-ish string compare so a wrong password doesn't leak timing
// info about how many leading characters matched.
function safeEqual(a, b) {
  const bufA = new TextEncoder().encode(String(a));
  const bufB = new TextEncoder().encode(String(b));
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}

async function githubGetFile(env, path) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}?ref=${encodeURIComponent(
    env.GITHUB_BRANCH || "main"
  )}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "family-recipes-site",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`GitHub API error (${res.status}): ${detail.slice(0, 300)}`);
  }
  return res.json(); // { sha, content (base64, may be chunked with newlines), ... }
}

async function githubPutFile(env, path, base64Content, message, sha) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`;
  const body = {
    message,
    content: base64Content,
    branch: env.GITHUB_BRANCH || "main",
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "family-recipes-site",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`GitHub API error (${res.status}): ${detail.slice(0, 300)}`);
  }
  return res.json();
}

async function githubDeleteFile(env, path, message, sha) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "family-recipes-site",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      message,
      sha,
      branch: env.GITHUB_BRANCH || "main",
    }),
  });
  return res.ok; // non-fatal if this fails — an orphaned photo file is harmless
}

export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return json(
      {
        error:
          "Editing from the site isn't configured. Set GITHUB_TOKEN and GITHUB_REPO in the Cloudflare Pages project.",
      },
      500
    );
  }
  if (!env.EDIT_PASSWORD) {
    return json(
      { error: "Editing isn't configured. Set the EDIT_PASSWORD secret in the Cloudflare Pages project." },
      500
    );
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: "Could not read the submitted form." }, 400);
  }

  const password = (formData.get("password") || "").toString();
  if (!password || !safeEqual(password, env.EDIT_PASSWORD)) {
    return json({ error: "That password isn't right." }, 401);
  }

  const id = (formData.get("id") || "").toString().trim();
  if (!id || !isValidId(id)) {
    return json({ error: "Missing or invalid recipe id." }, 400);
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

  // Load the existing recipe so we know its createdAt, current photo, and the
  // sha GitHub requires to update (rather than create) a file.
  let existingFile;
  try {
    existingFile = await githubGetFile(env, `recipes/${id}.json`);
  } catch (err) {
    return json({ error: "Could not read the existing recipe. Please try again." }, 502);
  }
  if (!existingFile) {
    return json({ error: "That recipe no longer exists." }, 404);
  }

  let existing;
  try {
    existing = JSON.parse(base64ToUtf8(existingFile.content));
  } catch {
    return json({ error: "Could not read the existing recipe file." }, 500);
  }

  const removePhoto = (formData.get("removePhoto") || "").toString() === "1";
  const photo = formData.get("photo");
  const photoUrl = (formData.get("photoUrl") || "").toString().trim();
  const oldPhoto = existing.photo || null;

  let photoFilename = oldPhoto;
  let photoBase64 = null;
  let newPhotoSet = false;

  if (photo && typeof photo === "object" && photo.size > 0) {
    const ext = ALLOWED_IMAGE_TYPES[photo.type];
    if (!ext) return json({ error: "Photo must be a JPEG, PNG, WEBP, or GIF image." }, 400);
    if (photo.size > MAX_PHOTO_BYTES) return json({ error: "That photo is too large (5MB max)." }, 400);
    const bytes = new Uint8Array(await photo.arrayBuffer());
    photoBase64 = toBase64(bytes);
    photoFilename = `${id}${ext}`;
    newPhotoSet = true;
  } else if (photoUrl && /^https?:\/\//i.test(photoUrl)) {
    try {
      const imgRes = await fetch(photoUrl, {
        headers: { "User-Agent": "family-recipes-site" },
        redirect: "follow",
      });
      if (imgRes.ok) {
        const mime = (imgRes.headers.get("content-type") || "").split(";")[0].trim();
        const ext = ALLOWED_IMAGE_TYPES[mime];
        const buf = new Uint8Array(await imgRes.arrayBuffer());
        if (ext && buf.length > 0 && buf.length <= MAX_PHOTO_BYTES) {
          photoBase64 = toBase64(buf);
          photoFilename = `${id}${ext}`;
          newPhotoSet = true;
        }
      }
    } catch {
      /* leave photo as-is on any fetch/type/size problem */
    }
  } else if (removePhoto) {
    photoFilename = null;
  }

  try {
    // Commit the new photo first (so the JSON never references a missing image).
    if (newPhotoSet && photoBase64 && photoFilename) {
      let sha;
      if (photoFilename === oldPhoto) {
        const existingPhotoFile = await githubGetFile(env, `photos/${photoFilename}`);
        sha = existingPhotoFile ? existingPhotoFile.sha : undefined;
      }
      await githubPutFile(env, `photos/${photoFilename}`, photoBase64, `Update photo for "${name}"`, sha);
    }

    // Clean up the old photo file if it's being replaced or removed.
    if (oldPhoto && oldPhoto !== photoFilename) {
      try {
        const oldFile = await githubGetFile(env, `photos/${oldPhoto}`);
        if (oldFile) {
          await githubDeleteFile(env, `photos/${oldPhoto}`, `Remove old photo for "${name}"`, oldFile.sha);
        }
      } catch {
        /* non-fatal — an orphaned photo file is harmless */
      }
    }

    const recipe = {
      id,
      name,
      ingredients,
      instructions,
      notes,
      photo: photoFilename,
      createdAt: existing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await githubPutFile(
      env,
      `recipes/${id}.json`,
      utf8ToBase64(JSON.stringify(recipe, null, 2) + "\n"),
      `Edit recipe: ${name}`,
      existingFile.sha
    );

    return json(recipe, 200);
  } catch (err) {
    return json(
      { error: "Could not save those changes. Please try again in a moment." },
      502
    );
  }
}

// Anything other than POST on /api/edit.
export async function onRequest({ request }) {
  if (request.method === "POST") return; // handled above
  return json({ error: "Not found." }, 404);
}
