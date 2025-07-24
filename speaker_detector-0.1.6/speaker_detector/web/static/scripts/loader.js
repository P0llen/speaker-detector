import { includeHTML } from "/static/scripts/utils/include-html.js";

includeHTML(() => {
  import("/static/scripts/script.js")
    .then(mod => {
      console.log("✅ script.js loaded");
      mod.runSetup(); // ✅ only run after includes finish

      // ✅ Hide loading screen now that setup is complete
      const loadingEl = document.getElementById("loading-overlay");
      if (loadingEl) loadingEl.remove();
    })
    .catch(err => console.error("❌ Failed to load script.js:", err));
});
