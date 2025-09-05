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
      try { localStorage.setItem('active-tab', tabId); } catch {}
    });
  });

  // ✅ Restore last active tab (fallback to Identify if present, else first)
  hideAllTabs();
  let active = null;
  try { active = localStorage.getItem('active-tab'); } catch {}
  if (!active) {
    // Prefer Identify as a sensible default for your workflow
    const hasIdentify = Array.from(steps).some(s => s.dataset.tab === 'identify-speaker');
    active = hasIdentify ? 'identify-speaker' : (steps[0]?.dataset.tab);
  }
  const toActivate = Array.from(steps).find(s => s.dataset.tab === active) || steps[0];
  if (toActivate) {
    toActivate.click();
  }
}
