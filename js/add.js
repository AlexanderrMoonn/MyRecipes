(function () {
  const form = document.getElementById("recipe-form");
  const status = document.getElementById("form-status");
  const submitBtn = document.getElementById("submit-btn");
  const photoInput = document.getElementById("photo");
  const photoPreview = document.getElementById("photo-preview");
  const photoPreviewImg = document.getElementById("photo-preview-img");

  const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB (GitHub-friendly, base64 fits comfortably)

  photoInput.addEventListener("change", () => {
    const file = photoInput.files && photoInput.files[0];
    if (!file) {
      photoPreview.style.display = "none";
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      status.textContent = "That photo is too large (5MB max). Pick a smaller one.";
      status.className = "form-status error";
      photoInput.value = "";
      photoPreview.style.display = "none";
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      photoPreviewImg.src = e.target.result;
      photoPreview.style.display = "block";
    };
    reader.onerror = () => {
      photoPreview.style.display = "none";
    };
    reader.readAsDataURL(file);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    status.textContent = "";
    status.className = "form-status";

    const name = form.name.value.trim();
    const ingredients = form.ingredients.value.trim();
    const instructions = form.instructions.value.trim();

    if (!name || !ingredients || !instructions) {
      status.textContent = "Please fill in the recipe name, ingredients, and instructions.";
      status.className = "form-status error";
      return;
    }

    const photoFile = photoInput.files && photoInput.files[0];
    if (photoFile && photoFile.size > MAX_PHOTO_BYTES) {
      status.textContent = "That photo is too large (5MB max). Pick a smaller one.";
      status.className = "form-status error";
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Filing…";
    status.textContent = "Filing this recipe…";
    status.className = "form-status pending";

    try {
      const formData = new FormData(form);
      const res = await fetch("/api/recipes", {
        method: "POST",
        body: formData,
      });

      const contentType = res.headers.get("content-type") || "";
      let data = null;
      if (contentType.includes("application/json")) {
        try {
          data = await res.json();
        } catch {
          data = null;
        }
      }

      // If the add-on-site function isn't configured yet, the request 404s
      // (no /api route) or returns a config error. Give a clear message
      // instead of a cryptic parse failure.
      if (res.status === 404) {
        throw new Error(
          "Adding from the site isn't set up yet. See README (\"Enable adding recipes from the site\"), or add the recipe as a file in recipes/ on the backend."
        );
      }
      if (!res.ok) {
        throw new Error((data && data.error) || `Could not file that recipe (server said: ${res.status}).`);
      }
      if (!data || !data.id) {
        throw new Error("The server gave an unexpected response. Please try again.");
      }

      status.textContent =
        "Recipe filed! It'll appear in the box within about a minute, once the site finishes rebuilding.";
      status.className = "form-status success";
      form.reset();
      photoPreview.style.display = "none";
      submitBtn.textContent = "Filed ✓";
      // Leave the button disabled so the same recipe isn't double-filed.
    } catch (err) {
      status.textContent = (err && err.message) || "Something went wrong. Please try again.";
      status.className = "form-status error";
      submitBtn.disabled = false;
      submitBtn.textContent = "File this recipe";
    }
  });
})();
