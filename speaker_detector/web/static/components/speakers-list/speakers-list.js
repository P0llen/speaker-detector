// /static/components/speakers-list/speakers-list.js

import {
  fetchSpeakers,
  deleteSpeaker,
  renameSpeaker,
  improveSpeaker
} from "/static/scripts/utils/speakers.js";

export function setupSpeakersList(root = document.getElementById("speakers-list-root")) {
  if (!root) {
    console.error("❌ speakers-list mount not found");
    return;
  }

  fetchSpeakers()
    .then(data => {
      root.innerHTML = "";
      if (!Array.isArray(data) || data.length === 0) {
        root.innerHTML = "<em>No speakers enrolled yet.</em>";
        return;
      }

      const list = document.createElement("ul");

      for (const speaker of data) {
        const name = typeof speaker === "string" ? speaker : speaker.name || "Unknown";

        const li = document.createElement("li");
        li.innerHTML = `
          🧠 <strong>${name}</strong>
          <button data-action="rename" data-name="${name}">✏️</button>
          <button data-action="delete" data-name="${name}">🗑️</button>
          <button data-action="improve" data-name="${name}">➕ Improve</button>
        `;

        list.appendChild(li);
      }

      root.appendChild(list);

      // 🔁 Add click handlers for all buttons
      root.querySelectorAll("button").forEach(btn => {
        const action = btn.dataset.action;
        const name = btn.dataset.name;

        btn.addEventListener("click", async () => {
          if (action === "rename") {
            const newName = prompt("Enter new name for speaker:", name);
            if (newName && newName !== name) {
              await renameSpeaker(name, newName);
              setupSpeakersList(root); // refresh list
            }
          }

          if (action === "delete") {
            if (confirm(`Delete speaker "${name}"?`)) {
              await deleteSpeaker(name);
              setupSpeakersList(root); // refresh list
            }
          }

          if (action === "improve") {
            const file = await promptAudioFile();
            if (file) {
              await improveSpeaker(name, file);
              alert(`✅ Improved model for "${name}"`);
            }
          }
        });
      });
    })
    .catch(err => {
      console.error("❌ Failed to load speakers:", err);
      root.innerHTML = "<em>Error loading speakers.</em>";
    });
}




function promptAudioFile() {
  return new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*";
    input.onchange = () => resolve(input.files[0]);
    input.click();
  });
}

