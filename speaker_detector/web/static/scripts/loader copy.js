import { includeHTML } from "/static/scripts/utils/include-html.js";

includeHTML(() => {
  import("/static/scripts/script.js")
    .then(mod => {
      console.log("✅ script.js loaded");
      mod.runSetup(); // ✅ only run after includes finish
    })
    .catch(err => console.error("❌ Failed to load script.js:", err));
});
