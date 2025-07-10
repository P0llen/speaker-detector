export function setupAccordionNav() {
  const mount = document.getElementById("accordion-nav-root");
  const template = document.getElementById("accordion-nav-template");
  if (!mount || !template) return;

  const clone = template.content.cloneNode(true);
  mount.appendChild(clone);

  const steps = mount.querySelectorAll(".accordion-step");

  const rootIds = [
    "mic-test-root",
    "enroll-speaker-root",
    "identify-speaker-root",
    "meeting-mode-root",
    "recordings-tab-root",
  ];

  function hideAllTabs() {
    rootIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = "none";
    });
  }

  steps.forEach(step => {
    step.addEventListener("click", () => {
      const tabId = step.dataset.tab;
      const rootId = `${tabId}-root`;
      const target = document.getElementById(rootId);
      if (!target) {
        console.warn(`⚠️ No tab container found for #${rootId}`);
        return;
      }

      // Hide all root containers
      hideAllTabs();

      // Activate current tab
      steps.forEach(s => s.classList.remove("active"));
      step.classList.add("active");

      target.style.display = "block";
    });
  });

  // ✅ Show only the first tab by default
  hideAllTabs();
  const firstId = steps[0]?.dataset.tab;
  const firstRoot = document.getElementById(`${firstId}-root`);
  if (firstRoot) firstRoot.style.display = "block";
}
