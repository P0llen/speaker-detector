// /static/components/recordings-tab/recordings-tab.js

export function setupRecordingsTab() {
const template = document.getElementById("recordings-tab-template");
const root = document.getElementById("recordings-tab-root");

  if (!template || !root) {
    console.error("❌ Recordings tab template or root not found");
    return;
  }

  const clone = template.content.cloneNode(true);
  root.appendChild(clone);

  const recordBtn = document.getElementById("record-bg-btn");
  const statusEl = document.getElementById("record-bg-status");
  const listEl = document.getElementById("recordings-list");

  // 🔊 Background noise recording
  if (recordBtn && statusEl) {
    recordBtn.onclick = async () => {
      statusEl.textContent = "🎙 Recording background noise...";

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
        const chunks = [];

        recorder.ondataavailable = (e) => chunks.push(e.data);

        recorder.onstop = async () => {
          const blob = new Blob(chunks, { type: "audio/webm" });
          const form = new FormData();
          form.append("audio", blob, `noise_${Date.now()}.webm`);

          try {
            const res = await fetch("/api/background_noise", {
              method: "POST",
              body: form,
            });
            const data = await res.json();
            statusEl.textContent = data.success
              ? "✅ Background noise saved."
              : `❌ ${data.error || "Unknown error"}`;
          } catch (err) {
            console.error("❌ Upload failed:", err);
            statusEl.textContent = "❌ Failed to save noise.";
          }

          stream.getTracks().forEach((t) => t.stop());
        };

        recorder.start();
        setTimeout(() => recorder.stop(), 3000);

      } catch (err) {
        console.error("❌ Mic access error:", err);
        statusEl.textContent = "❌ Could not access microphone.";
      }
    };
  }

  // 📂 Load and display list of recordings
  if (listEl) {
    fetch("/api/recordings")
      .then((res) => res.json())
      .then((data) => {
        if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
          listEl.innerHTML = "<li><em>No recordings found.</em></li>";
          return;
        }

        const html = Object.entries(data)
          .map(([speaker, files]) => {
            const count = Array.isArray(files) ? files.length : 0;
            return `<li><strong>${speaker}</strong>: ${count} file${count !== 1 ? "s" : ""}</li>`;
          })
          .join("");

        listEl.innerHTML = html;
      })
      .catch((err) => {
        console.error("❌ Failed to fetch recordings:", err);
        listEl.innerHTML = "<li><em>Error loading recordings.</em></li>";
      });
  }
}

