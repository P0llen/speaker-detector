export async function includeHTML(callback) {
  const elements = document.querySelectorAll("[include-html]");
  for (const el of elements) {
    const file = el.getAttribute("include-html");
    if (!file) continue;

    try {
      const response = await fetch(file);
      if (!response.ok) throw new Error(`Could not load ${file}`);
      const html = await response.text();
      el.innerHTML = html;

      // ✅ CSP-safe: don't use inline styles
      el.removeAttribute("include-html");
      el.classList.add("included-component");
    } catch (err) {
      el.innerHTML = `<p style="color:red">❌ Failed to include ${file}</p>`;
    }
  }

  if (callback) callback();
}
