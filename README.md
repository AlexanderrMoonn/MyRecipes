# Family Recipes — static site

A recipe box that runs as a **static website** on Cloudflare Pages. There is no
Node server to keep running. Recipes are plain files in this repo; the site
reads them; a small optional function lets you add recipes from the site too.

## How it works

- **Recipes live in the repo** as `recipes/<id>.json` files. This is your
  "backend". A photo (if any) lives in `photos/<id>.<ext>`.
- **The site shows them.** At deploy time, `build.js` scans `recipes/*.json` and
  writes `recipes/index.json` (the manifest). The pages read that manifest to
  list, search, and open recipes — all in the browser.
- **Add on the backend:** drop a new `recipes/<id>.json` file in the repo (copy
  an existing one and change the fields), commit, and push. The manifest
  regenerates on deploy and it appears.
- **Edit / delete on the backend:** edit or delete the recipe's `.json` file
  (and its photo). On the next deploy the site reflects the change.
- **Add on the site:** the "Add a recipe" form posts to a Cloudflare Pages
  Function (`functions/api/recipes.js`) that commits a new recipe file to this
  repo for you. Cloudflare then rebuilds and the recipe shows up — usually
  within a minute. (This one feature needs a token; see below.)

A recipe file looks like this:

```json
{
  "id": "grandmas-sunday-sauce-a1b2c3",
  "name": "Grandma's Sunday Sauce",
  "ingredients": "2 tbsp olive oil\n1 onion, chopped\n...",
  "instructions": "Warm the oil...\n\nStir in the garlic...",
  "notes": "Freezes well.",
  "photo": null,
  "createdAt": "2026-01-15T15:00:00.000Z"
}
```

`id` must be unique and use only lowercase letters, numbers, and dashes. If a
recipe has a photo, set `"photo": "the-id.jpg"` and put that image in `photos/`.

## Deploy to Cloudflare Pages

1. Push this folder to your GitHub repo (e.g. `AlexanderrMoonn/MyRecipes`).
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to
   Git**, and pick the repo.
3. Set the build configuration:
   - **Framework preset:** None
   - **Build command:** `node build.js`
   - **Build output directory:** `/`  (just a single slash — the site is at the
     repo root)
4. Save and deploy. When it finishes, open the `*.pages.dev` URL. You should see
   the box with the sample recipe.

That's the whole site. Reading, searching, and opening recipes work now, and you
can add/edit/delete recipes by managing files in `recipes/`.

> **Why your old deployment 404'd:** the previous version was an Express server
> (`server.js`). Cloudflare Pages serves static files and doesn't run that
> server, so every page and API call returned "page can't be found." This
> version has no server to run — it's files plus one small function.

### Custom domain (recipes.moonlanding.app)

In the Pages project → **Custom domains → Set up a domain**, enter
`recipes.moonlanding.app`. `moonlanding.app` must be a domain you control; add
the CNAME Cloudflare shows you at your DNS provider. Until that's done, use the
`*.pages.dev` URL.

## Enable adding recipes from the site (optional)

The form only needs this if you want people to add recipes **without touching
the repo**. Without it, the site still works; adding is done by committing files.

The function commits new recipes to GitHub on your behalf, so it needs a token.

1. **Create a GitHub token.** GitHub → Settings → Developer settings →
   **Fine-grained tokens** → Generate new token.
   - **Repository access:** Only select repositories → this repo.
   - **Permissions:** Repository permissions → **Contents → Read and write**.
   - Generate and copy the token (starts with `github_pat_...`).
2. **Add it to Cloudflare Pages.** Your Pages project → **Settings →
   Environment variables → Add** (Production):
   - `GITHUB_TOKEN` → paste the token → mark it as a **Secret**.
   - `GITHUB_REPO` → `owner/repo` (e.g. `AlexanderrMoonn/MyRecipes`).
   - `GITHUB_BRANCH` → `main`.
3. **Redeploy** (Deployments → Retry deployment, or push a commit).

Now "File this recipe" on the site commits the recipe to the repo, Cloudflare
rebuilds, and it appears in the box within about a minute.

**Note:** like the original, there's no login — anyone who can reach the site can
add a recipe. That's fine for a private family link; if the site is public and
you want to prevent strangers adding cards, keep this feature off and add
recipes via the repo instead.

## Local preview

```
node build.js       # regenerate recipes/index.json
```

Then serve the folder with any static server, e.g. `npx serve .`, and open the
printed URL. (The add-on-site form won't work locally — it needs the Cloudflare
function and token — but everything else does.)

## Files

```
index.html / add.html / recipe.html   the three pages
css/style.css                         styling (the index-card look)
js/main.js                            catalog + search
js/recipe.js                          single recipe view
js/add.js                             the add form
js/footer.js                          "last recipe added" footer
recipes/<id>.json                     one file per recipe  ← your data
recipes/index.json                    generated manifest (don't edit by hand)
photos/<id>.<ext>                     recipe photos
functions/api/recipes.js              add-on-site (commits to GitHub)
build.js                              regenerates the manifest at deploy time
_headers                              caching rules
```
