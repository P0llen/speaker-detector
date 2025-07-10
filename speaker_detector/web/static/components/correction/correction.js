// /static/components/correction/correction.js

export function setupCorrection() {
  const template = document.getElementById("correction-template");
  const mount = document.getElementById("correction-root");

  if (!template || !mount) {
    console.error("❌ Correction template or root not found");
    return;
  }

  const clone = template.content.cloneNode(true);
  const overlay = clone.querySelector(".correction-overlay");
  overlay.style.display = "none"; // Hide initially

  mount.appendChild(clone);
}

export function showCorrectionUI(blob, anchorEl) {
  const overlay = document.querySelector(".correction-overlay");
  const audioEl = document.querySelector(".correction-audio");
  const dropdown = document.querySelector(".correction-dropdown");
  const newInput = document.querySelector(".new-speaker-input");
  const markBtn = document.querySelector(".mark-background");
  const submitBtn = document.querySelector(".submit-correction");
  const cancelBtn = document.querySelector(".cancel-correction");

  if (!overlay || !audioEl || !dropdown || !newInput || !markBtn || !submitBtn || !cancelBtn) {
    console.error("❌ Correction UI element missing");
    return;
  }

  // Set up audio preview
  const url = URL.createObjectURL(blob);
  audioEl.src = url;

  // Populate dropdown with speakers
  fetch("/api/speakers/list-names")
    .then(res => res.json())
    .then(data => {
      dropdown.innerHTML = "";
      data.speakers.forEach(name => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        dropdown.appendChild(opt);
      });
    });

  overlay.style.display = "flex";

  cancelBtn.onclick = () => {
    overlay.style.display = "none";
    URL.revokeObjectURL(url);
  };

  markBtn.onclick = () => {
    const form = new FormData();
    form.append("file", blob, "background.webm");
    fetch("/api/save-background", { method: "POST", body: form })
      .then(res => res.json())
      .then(() => {
        alert("🎧 Background noise saved.");
        overlay.style.display = "none";
      });
  };

  submitBtn.onclick = () => {
    const speaker = newInput.value || dropdown.value;
    if (!speaker) {
      alert("Please select or enter a speaker name.");
      return;
    }

    const form = new FormData();
    form.append("file", blob, "correction.webm");
    form.append("speaker", speaker);

    fetch("/api/enroll", { method: "POST", body: form })
      .then(res => res.json())
      .then(() => {
        alert(`✅ Sample added for ${speaker}`);
        overlay.style.display = "none";
      });
  };
}

// Auto-run setup
// setupCorrection();
