// script.js

console.log("✅ script.js loaded");


let mediaRecorder;
let finalBlob = null;
let meetingId = null;
const MAX_MEETINGS = 3;


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




let currentMode = 1;

toggleOptions.forEach(option => {
  option.addEventListener('click', () => {
    toggleOptions.forEach(opt => opt.classList.remove('active'));
    option.classList.add('active');
    currentMode = parseInt(option.getAttribute('data-mode'));

    enrollArea.style.display = "none";

    if (currentMode === 1) {
      operationLabel.textContent = "Mode: Mic Test";
      actionBtn.textContent = "▶️ Start Mic Test";
    } else if (currentMode === 2) {
      operationLabel.textContent = "Mode: Enroll Speaker";
      actionBtn.textContent = "📝 Start Enrollment";
      enrollArea.style.display = "block";
    } else if (currentMode === 3) {
      operationLabel.textContent = "Mode: Identify Speaker";
      actionBtn.textContent = "🔍 Identify Speaker";
    }
  });
});

actionBtn.onclick = function() {
  if (currentMode === 1) {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => setupVisualizer(stream, "identify-visualizer"));
  } else if (currentMode === 2) {
    recordAndEnroll();
  } else if (currentMode === 3) {
    recordAndIdentify();
  }
};

const tabButtons = document.querySelectorAll('.tab-button');
const tabContents = document.querySelectorAll('.tab-content');

tabButtons.forEach(button => {
  button.addEventListener('click', () => {
    tabButtons.forEach(btn => btn.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));

    button.classList.add('active');
    document.getElementById(button.dataset.tab).classList.add('active');
  });
});


// ─── Fetch & render enrolled speakers ───────────────────────────────────────
async function fetchSpeakers() {
  try {
    const res = await fetch("/api/speakers");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const speakers = await res.json();

    const list = document.getElementById("speakers-list");
    list.innerHTML = "";

    if (speakers.length === 0) {
      return list.insertAdjacentHTML("beforeend",
        `<li><em>No speakers enrolled.</em></li>`);
    }

    speakers.forEach(id => {
      list.insertAdjacentHTML("beforeend",
        `<li>${id}</li>`);
    });
  } catch (err) {
    console.error("Failed loading speakers:", err);
  }
}


// ─── Fetch & render meetings ────────────────────────────────────────────────
async function fetchMeetings() {
  try {
    const res = await fetch("/api/meetings");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const meetings = await res.json();

    const container = document.getElementById("meeting-list");
    container.innerHTML = "";

    // disable start if at max
    startBtn.disabled = meetings.length >= MAX_MEETINGS;
    startBtn.title    = meetings.length >= MAX_MEETINGS
      ? "🛑 Max meetings stored."
      : "";

    if (meetings.length === 0) {
      container.innerHTML = "<em>No meetings saved yet.</em>";
      return;
    }

    meetings.forEach(id => {
      const div = document.createElement("div");
      div.innerHTML = `
        <strong>${id}</strong>
        <button onclick="generateSummaryFor('${id}')">📄 Summary</button>
        <button onclick="exportMeeting('${id}')">💾 Export</button>
        <button onclick="deleteMeeting('${id}')">🗑️ Delete</button>
      `;
      container.appendChild(div);
    });
  } catch (err) {
    console.error("Failed loading meetings:", err);
  }
}

// ─── Fetch & render recordings ─────────────────────────────────────────────
async function fetchRecordings() {
  try {
    const res = await fetch("/api/recordings");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const recordings = await res.json();

    const list = document.getElementById("recordings-list");
    list.innerHTML = "";

    if (!recordings || recordings.length === 0) {
      list.innerHTML = "<li><em>No recordings available.</em></li>";
      return;
    }

    recordings.forEach(filename => {
      const li = document.createElement("li");
      li.innerHTML = `
        ${filename}
        <span class="action-icons">
          <button title="Rename" onclick="renameRecording('${filename}')">✏️</button>
          <button title="Delete" onclick="deleteRecording('${filename}')">🗑️</button>
        </span>
      `;
      list.appendChild(li);
    });
  } catch (err) {
    console.error("Failed loading recordings:", err);
  }
}


// ─── Recording controls ────────────────────────────────────────────────────
function startMeeting() {
  meetingId = generateMeetingId();
  finalBlob = null;

  startBtn.disabled = true;
  stopBtn.disabled  = false;
  statusEl.textContent = "Status: Recording...";
  statusEl.style.color = "red";
  speakerEl.textContent = "Current speaker: —";
  timelineEl.innerHTML  = "<em>Listening...</em>";

  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {

    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    mediaRecorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) finalBlob = e.data;
    };
    mediaRecorder.onstop = async () => {
      stopBtn.disabled = true;
      startBtn.disabled = false;
      statusEl.textContent = "Status: Recording stopped.";
      statusEl.style.color = "";

      if (finalBlob) {
        const formData = new FormData();
        formData.append('file', finalBlob, `${meetingId}.webm`);
        formData.append('meeting_id', meetingId);
        try {
          const res = await fetch('/api/save-chunk', { method: 'POST', body: formData });
          console.log('✅ Full recording saved:', await res.json());
        } catch (err) {
          console.error('❌ Error saving chunk:', err);
        }
      }

      fetchMeetings();
    };
    mediaRecorder.start();
  });
}

function stopMeeting() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
}

// ─── Summary, Export & Delete ──────────────────────────────────────────────
async function generateSummaryFor(id) {
  try {
    const res  = await fetch(`/api/generate-summary/${id}`);
    const data = await res.json();

    timelineEl.innerHTML = "<strong>📄 Meeting Summary:</strong>";
    if (data.transcript) {
      const pre = document.createElement('pre');
      pre.textContent = data.transcript;
      pre.style = "border:1px solid #ccc;padding:10px;white-space:pre-wrap;word-break:break-word";
      timelineEl.appendChild(pre);
    }
    if (Array.isArray(data.segments)) {
      data.segments.forEach(seg => {
        const div = document.createElement('div');
        div.textContent = `[${formatTime(seg.start)}–${formatTime(seg.end)}] `
                         + `${seg.speaker} (score: ${seg.score}): ${seg.text}`;
        timelineEl.appendChild(div);
      });
    }
  } catch (err) {
    console.error('❌ Error generating summary:', err);
  }
}

function exportMeeting(id) {
  alert(`🔧 Export for "${id}" not implemented.`);
}

async function deleteMeeting(id) {
  await fetch(`/api/delete-meeting/${id}`, { method: 'DELETE' });
  fetchMeetings();
}


// ─── Record a short clip & identify the speaker ─────────────────────────────
// Record ~3s, call /api/identify and show result in the UI
async function recordAndIdentify() {
  console.log("▶️ recordAndIdentify invoked");
  const resultEl = document.getElementById("identify-result");
  if (!resultEl) {
    console.error("❌ <div id=\"identify-result\"> not found");
    return;
  }
  resultEl.textContent = "Recording & identifying…";

  try {
    console.log("🔒 requesting mic access");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    setupVisualizer(stream, "identify-visualizer"); // or "record-visualizer"

    console.log("🎤 mic access granted");
    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    const chunks = [];

    recorder.ondataavailable = e => {
      console.log("🔊 chunk captured:", e.data);
      chunks.push(e.data);
    };

    const stopped = new Promise(resolve => recorder.addEventListener("stop", resolve));
    recorder.start();
    console.log("⏺️ recorder started");
    setTimeout(() => {
      console.log("⏹️ stopping recorder after timeout");
      recorder.stop();
    }, 3000);
    await stopped;
    console.log("🛑 recorder stopped, building blob");

    const blob = new Blob(chunks, { type: chunks[0]?.type });
    console.log("📦 blob ready, size=", blob.size);
    const form = new FormData();
    form.append("file", blob, "identify.webm");

    console.log("📨 sending to /api/identify");
    const res = await fetch("/api/identify", { method: "POST", body: form });
    console.log("📥 response status:", res.status);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const { speaker, score, error } = await res.json();
    console.log("📑 parsed JSON:", { speaker, score, error });

    if (error) {
      resultEl.textContent = `❌ Error: ${error}`;
    } else {
      resultEl.textContent = `🗣️ Speaker: ${speaker} (score: ${score})`;
    }

    console.log("✅ UI updated with result");
    stream.getTracks().forEach(t => t.stop());
    console.log("🚿 mic tracks stopped");
  } catch (err) {
    console.error("❌ recordAndIdentify error:", err);
    resultEl.textContent = `❌ ${err.message}`;
  }
}



// ─── Record a short clip & enroll under given ID ────────────────────────────
function recordAndEnroll() {
  const speakerId = document.getElementById("speaker-id").value.trim();
  if (!speakerId) {
    return alert("Please enter a speaker ID before enrolling.");
  }
  const resultEl = document.getElementById("identify-result");
  resultEl.textContent = `Recording for enroll: "${speakerId}"…`;
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
      setupVisualizer(stream, "record-visualizer"); // or "record-visualizer"
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      const chunks = [];
      recorder.ondataavailable = e => chunks.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: chunks[0].type });
        const form = new FormData();
        form.append("file", blob, "enroll.webm");
        try {
          const res = await fetch(`/api/enroll/${encodeURIComponent(speakerId)}`, {
            method: "POST",
            body: form,
          });
          const json = await res.json();
          if (json.status === "enrolled") {
            resultEl.textContent = `✅ Enrolled "${speakerId}".`;
            fetchSpeakers();  // refresh your speakers list
          } else {
            resultEl.textContent = `❌ Enroll error: ${json.error || "unknown"}`;
          }
        } catch (err) {
          console.error(err);
          resultEl.textContent = "❌ Enroll failed.";
        }
        stream.getTracks().forEach(t => t.stop());
      };
      recorder.start();
      setTimeout(() => recorder.stop(), 3000);
    })
    .catch(err => {
      console.error(err);
      resultEl.textContent = "❌ Microphone error.";
    });
}

function renameRecording(filename) {
  const newName = prompt("Rename recording:", filename);
  if (newName && newName !== filename) {
    fetch(`/api/recordings/rename`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ oldName: filename, newName })
    })
    .then(res => {
      if (!res.ok) throw new Error("Failed to rename");
      return res.json();
    })
    .then(() => {
      alert(`✅ Renamed to ${newName}`);
      fetchRecordings();
    })
    .catch(err => {
      console.error("Rename failed:", err);
      alert("❌ Rename failed");
    });
  }
}

function deleteRecording(filename) {
  if (confirm(`Are you sure you want to delete ${filename}?`)) {
    fetch(`/api/recordings/${encodeURIComponent(filename)}`, {
      method: 'DELETE'
    })
    .then(res => {
      if (!res.ok) throw new Error("Failed to delete");
      return res.json();
    })
    .then(() => {
      alert(`🗑️ Deleted ${filename}`);
      fetchRecordings();
    })
    .catch(err => {
      console.error("Delete failed:", err);
      alert("❌ Delete failed");
    });
  }
}


// ─── Initialization ────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  
// UI elements
const startBtn   = document.getElementById("start-meeting");
const stopBtn    = document.getElementById("stop-meeting");
const timelineEl = document.getElementById("timeline");
const statusEl   = document.getElementById("meeting-status");
const speakerEl  = document.getElementById("speaker-label");
const toggleOptions = document.querySelectorAll('.toggle-option');
const operationLabel = document.getElementById('operation-label');
const enrollArea = document.getElementById('enroll-area');
const actionBtn = document.getElementById('action-btn');

  startBtn.onclick = startMeeting;
  stopBtn.onclick  = stopMeeting;

  // wire up list buttons if they exist
  document.getElementById("list-meetings-btn")?.addEventListener("click", fetchMeetings);
  document.getElementById("list-recordings-btn")?.addEventListener("click", fetchRecordings);
  
  // Enrolled speakers
  document.getElementById("refresh-speakers-btn").addEventListener("click", fetchSpeakers);
  

  // always refresh on load
  fetchMeetings();
  fetchSpeakers();
  fetchRecordings();
});
