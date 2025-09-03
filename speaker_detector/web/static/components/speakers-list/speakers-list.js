import {
  fetchSpeakers,
  deleteSpeaker,
  renameSpeaker,
  improveSpeaker
} from "/static/scripts/utils/speakers.js";

// 🆕 helper to get speakers that need rebuilding
async function fetchSpeakersNeedingRebuild() {
  try {
    const res = await fetch("/api/speakers/needs-rebuild");
    const data = await res.json();
    return data.toRebuild || [];
  } catch (err) {
    console.error("❌ Failed to check rebuild status:", err);
    return [];
  }
}

// Legacy helper retained (unused by new UI flow)
async function rebuildSpeaker(name) {
  const res = await fetch(`/api/rebuild/${name}`, { method: "POST" });
  return res.json();
}

export async function setupSpeakersList(root = document.getElementById("speakers-list-root")) {
  if (!root) {
    console.error("❌ speakers-list mount not found");
    return;
  }

  try {
    const [data, needsRebuild] = await Promise.all([
      fetchSpeakers(),
      fetchSpeakersNeedingRebuild()
    ]);

    root.innerHTML = "";
    if (!Array.isArray(data) || data.length === 0) {
      root.innerHTML = "<em>No speakers enrolled yet.</em>";
      return;
    }

    const list = document.createElement("ul");

    for (const speaker of data) {
      const name = typeof speaker === "string" ? speaker : speaker.name || "Unknown";
      const needs = needsRebuild.includes(name);

      const li = document.createElement("li");
      li.innerHTML = `
        🧠 <strong>${name}</strong>
        ${needs ? '<span style="color: #ff0;">⚠️ Needs Rebuild</span>' : ""}
        <button data-action="rename" data-name="${name}">✏️</button>
        <button data-action="delete" data-name="${name}">🗑️</button>
        <button data-action="improve" data-name="${name}">➕ Improve</button>
        <button data-action="rebuild" data-name="${name}">🔁 Rebuild</button>
        <span class="rebuild-status" data-name="${name}"></span>
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
            setupSpeakersList(root); // refresh to reflect rebuild-needed status
          }
        }

        if (action === "rebuild") {
          // Find status span within the same list item as this button
          const item = btn.closest('li') || root;
          const status = item.querySelector(`.rebuild-status[data-name="${name}"]`) || item.querySelector('.rebuild-status');
          const thisBtn = btn; // reference clicked button

          // Build/attach a lightweight progress bar
          let progress = item.querySelector('.rebuild-progress');
          if (!progress) {
            progress = document.createElement('div');
            progress.className = 'progress rebuild-progress';
            const bar = document.createElement('div');
            bar.className = 'progress-bar';
            progress.appendChild(bar);
            status?.insertAdjacentElement('afterend', progress) || item.appendChild(progress);
          } else {
            progress.classList.remove('ok','err');
            const bar = progress.querySelector('.progress-bar');
            if (bar) bar.style.width = '0%';
          }

          const bar = progress.querySelector('.progress-bar');
          let pct = 0;
          const startedAt = Date.now();
          const tick = setInterval(() => {
            if (pct < 80) pct += 2;
            else if (pct < 98) pct += 0.5;
            pct = Math.min(98, pct);
            if (bar) bar.style.width = pct + '%';
            if (status && pct > 95 && !status.textContent.includes('✅') && !status.textContent.includes('❌')) {
              status.textContent = 'Finalizing...';
            }
          }, 120);

          try {
            thisBtn.disabled = true;
            if (status) status.textContent = 'Rebuilding...';
            const res = await fetch(`/api/rebuild/${encodeURIComponent(name)}`, { method: 'POST' });
            const data = await res.json();
            clearInterval(tick);
            if (res.ok && data.status === 'rebuilt') {
              if (bar) bar.style.width = '100%';
              progress.classList.add('ok');
              if (status) status.textContent = '✅ Rebuilt';
            } else {
              if (bar) bar.style.width = '100%';
              progress.classList.add('err');
              if (status) status.textContent = `❌ Failed${data?.error ? ': ' + data.error : ''}`;
            }
          } catch (err) {
            console.error('❌ Rebuild error:', err);
            clearInterval(tick);
            if (bar) bar.style.width = '100%';
            progress.classList.add('err');
            if (status) status.textContent = '❌ Network error';
          } finally {
            const spent = Date.now() - startedAt;
            const minShow = 1200;
            setTimeout(() => {
              thisBtn.disabled = false;
              // Clear progress UI and status, then refresh list
              progress?.remove();
              if (status) status.textContent = '';
              setupSpeakersList(root);
            }, Math.max(0, minShow - spent));
          }
        }
      });
    });
  } catch (err) {
    console.error("❌ Failed to load speakers:", err);
    root.innerHTML = "<em>Error loading speakers.</em>";
  }
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
