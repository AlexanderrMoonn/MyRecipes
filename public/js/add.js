(function () {
  const form = document.getElementById("recipe-form");
  const status = document.getElementById("form-status");
  const submitBtn = document.getElementById("submit-btn");
  const photoInput = document.getElementById("photo");
  const photoPreview = document.getElementById("photo-preview");
  const photoPreviewImg = document.getElementById("photo-preview-img");

  photoInput.addEventListener("change", () => {
    const file = photoInput.files && photoInput.files[0];
    if (!file) {
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

    submitBtn.disabled = true;
    submitBtn.textContent = "Filing…";

    try {
      const formData = new FormData(form);
      const res = await fetch("/api/recipes", {
        method: "POST",
        body: formData,
      });

      // The server always replies with JSON (success or error) — but if
      // something in front of it (a proxy, an ad blocker extension, a
      // dropped connection) returns something else, don't let a failed
      // res.json() call show a confusing low-level error.
      const contentType = res.headers.get("content-type") || "";
      let data = null;
      if (contentType.includes("application/json")) {
        try {
          data = await res.json();
        } catch {
          data = null;
        }
      }

      if (!res.ok) {
        throw new Error((data && data.error) || `Could not save that recipe (server said: ${res.status}).`);
      }
      if (!data) {
        throw new Error("The server gave an unexpected response. Please try again.");
      }

      status.textContent = "Recipe filed! Taking you to it now…";
      status.className = "form-status success";

      setTimeout(() => {
        window.location.href = `/recipe.html?id=${encodeURIComponent(data.id)}`;
      }, 600);
    } catch (err) {
      status.textContent = (err && err.message) || "Something went wrong. Please try again.";
      status.className = "form-status error";
      submitBtn.disabled = false;
      submitBtn.textContent = "File this recipe";
    }
  });
})();
