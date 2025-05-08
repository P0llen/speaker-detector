console.log("✅ script.js loaded");

let mediaRecorder;
let finalBlob = null;
let meetingId = null;
const MAX_MEETINGS = 3;
let currentMode = 1;

window.addEventListener("DOMContentLoaded", () => {
  // UI elements
  const startBtn = document.getElementById("start-meeting");
  const stopBtn = document.getElementById("stop-meeting");
  const timelineEl = document.getElementById("timeline");
  const statusEl = document.getElementById("meeting-status");
  const speakerEl = document.getElementById("speaker-label");
  const toggleOptions = document.querySelectorAll(".toggle-option");
  const operationLabel = document.getElementById("operation-label");
  const enrollArea = document.getElementById("enroll-area");
  const actionBtn = document.getElementById("action-btn");

  // Toggle behavior (Mic Test / Enroll / Identify)
  toggleOptions.forEach((option) => {
    option.addEventListener("click", () => {
      toggleOptions.forEach((opt) => opt.classList.remove("active"));
      option.classList.add("active");
      currentMode = parseInt(option.dataset.mode);
      enrollArea.style.display = currentMode === 2 ? "block" : "none";

      if (currentMode === 1) {
        
        actionBtn.textContent = "▶️ Start Mic Test";
      } else if (currentMode === 2) {
    
        actionBtn.textContent = "📝 Start Enrollment";
      } else if (currentMode === 3) {
        
        actionBtn.textContent = "🔍 Identify Speaker";
      }
    });
  });

  actionBtn.addEventListener("click", () => {
    if (currentMode === 1) {
      navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) =>
        setupVisualizer(stream, "identify-visualizer")
      );
    } else if (currentMode === 2) {
      recordAndEnroll();
    } else if (currentMode === 3) {
      recordAndIdentify();
    }
  });

  // Tabs
  const tabButtons = document.querySelectorAll(".tab-button");
  const tabContents = document.querySelectorAll(".tab-content");

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      tabButtons.forEach((btn) => btn.classList.remove("active"));
      tabContents.forEach((tab) => tab.classList.remove("active"));
      button.classList.add("active");
      document.getElementById(button.dataset.tab).classList.add("active");
    });
  });

  // Refresh buttons
  document.getElementById("refresh-speakers-btn")?.addEventListener("click", fetchSpeakers);
  document.getElementById("list-recordings-btn")?.addEventListener("click", fetchRecordings);

  startBtn.onclick = startMeeting;
  stopBtn.onclick = stopMeeting;

  // Global event handler for rename/delete buttons
  document.body.addEventListener("click", async (e) => {
    const target = e.target;
    const container = target.closest("[data-type][data-id]");
    if (!container) return;

    const id = container.getAttribute("data-id");
    const type = container.getAttribute("data-type");

    if (target.classList.contains("rename-btn")) {
      await renameItem(type, id);
    }

    if (target.classList.contains("delete-btn")) {
      await deleteItem(type, id);
    }
  });

  // Initial fetches
  fetchMeetings();
  fetchSpeakers();
  fetchRecordings();
  console.log("📌 Current Mode:", currentMode);

});


// Helpers
function generateMeetingId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = String(Math.floor(sec % 60)).padStart(2, "0");
  return `${m}:${s}`;
}

function setupVisualizer(stream, canvasId) {
  const audioCtx = new AudioContext();
  const analyser = audioCtx.createAnalyser();
  const source = audioCtx.createMediaStreamSource(stream);
  source.connect(analyser);

  const canvas = document.getElementById(canvasId);
  const canvasCtx = canvas.getContext("2d");
  analyser.fftSize = 2048;
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function draw() {
    requestAnimationFrame(draw);
    analyser.getByteTimeDomainData(dataArray);

    canvasCtx.fillStyle = "#111";
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = "lime";
    canvasCtx.beginPath();

    const sliceWidth = (canvas.width * 1.0) / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * canvas.height) / 2;
      if (i === 0) {
        canvasCtx.moveTo(x, y);
      } else {
        canvasCtx.lineTo(x, y);
      }
      x += sliceWidth;
    }

    canvasCtx.lineTo(canvas.width, canvas.height / 2);
    canvasCtx.stroke();
  }

  draw();
}

// Fetching + Displaying Data
async function fetchSpeakers() {
  try {
    const res = await fetch("/api/speakers");
    const data = await res.json();
    const list = document.getElementById("speakers-list");
    list.innerHTML = "";

    if (data.length === 0) {
      list.innerHTML = "<li><em>No speakers enrolled.</em></li>";
    } else {
      data.forEach((id) => {
        const li = document.createElement("li");
        li.setAttribute("data-type", "speaker");
        li.setAttribute("data-id", id);
        li.innerHTML = `
          ${id}
          <span class="action-icons">
            <button class="rename-btn" title="Rename">✏️</button>
            <button class="delete-btn" title="Delete">🗑️</button>
          </span>
        `;
        list.appendChild(li);
      });
    }
  } catch (err) {
    console.error("❌ Failed to fetch speakers:", err);
  }
}



async function fetchMeetings() {
  try {
    const res = await fetch("/api/meetings");
    const meetings = await res.json();
    const container = document.getElementById("meeting-list");
    container.innerHTML = "";

    if (meetings.length === 0) {
      container.innerHTML = "<em>No meetings saved yet.</em>";
      return;
    }

    meetings.forEach((id) => {
      const div = document.createElement("div");
      div.setAttribute("data-type", "meeting");
      div.setAttribute("data-id", id);
      div.innerHTML = `
        <strong>${id}</strong>
        <span class="action-icons">
          <button onclick="generateSummaryFor('${id}')">📄 Summary</button>
          <button class="rename-btn" title="Rename">✏️</button>
          <button class="delete-btn" title="Delete">🗑️</button>
        </span>
      `;
      container.appendChild(div);
    });
  } catch (err) {
    console.error("❌ Failed to fetch meetings:", err);
  }
}



async function fetchRecordings() {
  try {
    const res = await fetch("/api/recordings");
    const data = await res.json();
    const list = document.getElementById("recordings-list");
    list.innerHTML = "";

    const speakers = Object.keys(data);
    if (speakers.length === 0) {
      list.innerHTML = "<li><em>No recordings available.</em></li>";
      return;
    }

    speakers.forEach((speaker) => {
      const recordings = data[speaker];
      if (recordings.length === 0) return;

      const groupTitle = document.createElement("li");
      groupTitle.innerHTML = `<strong>${speaker}</strong>`;
      list.appendChild(groupTitle);

      recordings.forEach((filename) => {
        const li = document.createElement("li");
        li.setAttribute("data-type", "recording");
        li.setAttribute("data-id", filename);
        li.innerHTML = `
          ${filename}
          <span class="action-icons">
            <button class="rename-btn" title="Rename">✏️</button>
            <button class="delete-btn" title="Delete">🗑️</button>
          </span>
        `;
        list.appendChild(li);
      });
    });
  } catch (err) {
    console.error("❌ Failed to fetch recordings:", err);
  }
}


// Record / Enroll / Identify
function startMeeting() {
  meetingId = generateMeetingId();
  finalBlob = null;

  const startBtn = document.getElementById("start-meeting");
  const stopBtn = document.getElementById("stop-meeting");
  const statusEl = document.getElementById("meeting-status");
  const speakerEl = document.getElementById("speaker-label");
  const timelineEl = document.getElementById("timeline");

  startBtn.disabled = true;
  stopBtn.disabled = false;
  statusEl.textContent = "Status: Recording...";
  statusEl.style.color = "red";
  speakerEl.textContent = "Current speaker: —";
  timelineEl.innerHTML = "<em>Listening...</em>";

  navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: "audio/webm;codecs=opus",
    });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) finalBlob = e.data;
    };

    mediaRecorder.onstop = async () => {
      stopBtn.disabled = true;
      startBtn.disabled = false;
      statusEl.textContent = "Status: Recording stopped.";
      statusEl.style.color = "";

      if (finalBlob) {
        const formData = new FormData();
        formData.append("file", finalBlob, `${meetingId}.webm`);
        formData.append("meeting_id", meetingId);
        await fetch("/api/save-chunk", { method: "POST", body: formData });
        fetchMeetings();
      }
    };

    mediaRecorder.start();
  });
}

function stopMeeting() {
  if (mediaRecorder?.state === "recording") mediaRecorder.stop();
}

async function generateSummaryFor(id) {
  const timelineEl = document.getElementById("timeline");
  timelineEl.innerHTML = "<strong>📄 Loading summary...</strong>";
  try {
    const res = await fetch(`/api/generate-summary/${id}`);
    const data = await res.json();
    if (data.transcript) {
      const pre = document.createElement("pre");
      pre.textContent = data.transcript;
      timelineEl.appendChild(pre);
    }
  } catch (err) {
    timelineEl.innerHTML = "<strong>❌ Failed to load summary.</strong>";
  }
}

function exportMeeting(id) {
  alert(`Export not yet implemented for: ${id}`);
}

async function deleteMeeting(id) {
  await fetch(`/api/delete-meeting/${id}`, { method: "DELETE" });
  fetchMeetings();
}

function recordAndIdentify() {
  const resultEl = document.getElementById("identify-result");
  resultEl.textContent = "Recording for identification...";

  navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    setupVisualizer(stream, "identify-visualizer");

    const recorder = new MediaRecorder(stream, {
      mimeType: "audio/webm;codecs=opus",
    });
    const chunks = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);

    recorder.onstop = async () => {
      const blob = new Blob(chunks);
      const form = new FormData();
      form.append("file", blob, "identify.webm");

      const res = await fetch("/api/identify", {
        method: "POST",
        body: form,
      });

      const { speaker, score, error } = await res.json();
      resultEl.textContent = error
        ? `❌ ${error}`
        : `🗣️ Speaker: ${speaker} (score: ${score})`;

      stream.getTracks().forEach((t) => t.stop());
    };

    recorder.start();
    setTimeout(() => recorder.stop(), 3000);
  });
}

function recordAndEnroll() {
  const id = document.getElementById("speaker-id").value.trim();
  const resultEl = document.getElementById("identify-result");
  if (!id) return alert("Please enter a speaker ID.");

  resultEl.textContent = `Recording to enroll "${id}"...`;

  navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    setupVisualizer(stream, "identify-visualizer");

    const recorder = new MediaRecorder(stream, {
      mimeType: "audio/webm;codecs=opus",
    });
    const chunks = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);

    recorder.onstop = async () => {
      const blob = new Blob(chunks);
      const form = new FormData();
      form.append("file", blob, "enroll.webm");

      const res = await fetch(`/api/enroll/${encodeURIComponent(id)}`, {
        method: "POST",
        body: form,
      });

      const data = await res.json();
      resultEl.textContent = data.status === "enrolled"
        ? `✅ Enrolled "${id}".`
        : `❌ ${data.error || "Unknown error."}`;

      fetchSpeakers();
      stream.getTracks().forEach((t) => t.stop());
    };

    recorder.start();
    setTimeout(() => recorder.stop(), 3000);
  });
}


async function renameItem(type, id) {
  const newName = prompt(`Rename ${type}:`, id);
  if (!newName || newName === id) return;

  try {
    const res = await fetch(`/api/${type}s/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldName: id, newName }),
    });

    if (!res.ok) throw new Error("Rename failed");
    alert(`✅ Renamed to ${newName}`);
    refreshData(type);
  } catch (err) {
    console.error("❌ Rename error:", err);
    alert("❌ Rename failed.");
  }
}

async function deleteItem(type, id) {
  if (!confirm(`Are you sure you want to delete ${type}: ${id}?`)) return;

  let endpoint = `/api/${type}s`;
  if (type === "meeting") endpoint = `/api/delete-meeting`; // custom route

  try {
    const url =
      type === "meeting"
        ? `${endpoint}/${id}`
        : `${endpoint}/${encodeURIComponent(id)}`;

    const res = await fetch(url, { method: "DELETE" });
    if (!res.ok) throw new Error("Delete failed");
    alert(`🗑️ Deleted ${type}: ${id}`);
    refreshData(type);
  } catch (err) {
    console.error("❌ Delete error:", err);
    alert("❌ Delete failed.");
  }
}
