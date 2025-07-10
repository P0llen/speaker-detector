// /static/components/enroll-speaker/enroll-speaker.js

import { setupSpeakersList } from "/static/components/speakers-list/speakers-list.js";

export function setupEnrollSpeaker() {
  const template = document.getElementById("enroll-speaker-template");
  const mount = document.getElementById("enroll-speaker-root");

  if (!template || !mount) {
    console.error("❌ Enroll Speaker template or root not found");
    return;
  }

  const clone = template.content.cloneNode(true);
  mount.appendChild(clone); // ✅ injects template

  // ✅ Now that it's in the DOM, safely look inside it
  const speakersRoot = mount.querySelector("#speakers-list-root");
  if (speakersRoot) {
    setupSpeakersList(speakersRoot);
  } else {
    console.warn("⚠️ #speakers-list-root not found after injection.");
  }

  // ⏺️ The rest of your enroll-speaker logic continues here...
  const speakerInput = mount.querySelector("#speaker-id");
  const enrollBtn = mount.querySelector("#enroll-speaker-btn");
  const status = mount.querySelector("#enroll-speaker-status");

  enrollBtn.onclick = async () => {
    const id = speakerInput.value.trim();
    if (!id) {
      status.textContent = "❌ Please enter a speaker ID.";
      return;
    }

    enrollBtn.disabled = true;
    status.textContent = "⏳ Enrolling...";

    try {
      const res = await fetch("/api/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speaker_id: id })
      });

      const data = await res.json();
      if (data.success) {
        status.textContent = `✅ Speaker "${id}" enrolled.`;
        setupSpeakersList(speakersRoot); // ✅ Refresh list after enroll
      } else {
        status.textContent = `❌ ${data.error || "Unknown error"}`;
      }
    } catch (err) {
      console.error("❌ Enroll API error:", err);
      status.textContent = "❌ Failed to enroll speaker.";
    }

    enrollBtn.disabled = false;
  };
}


// Auto-run
// setupEnrollSpeaker();
