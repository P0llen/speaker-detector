// script.js

let mediaRecorder;
let finalBlob = null;
let meetingId = null;
const MAX_MEETINGS = 3;

const startBtn   = document.getElementById("start-meeting");
const stopBtn    = document.getElementById("stop-meeting");
const timelineEl = document.getElementById("timeline");
const statusEl   = document.getElementById("meeting-status");
const speakerEl  = document.getElementById("speaker-label");

function generateMeetingId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function checkMeetingLimit() {
  const container = document.getElementById("meeting-list");
  if (!container) return;
  fetch("/meetings")
    .then(res => res.json())
    .then(meetings => {
      container.innerHTML = "";
      startBtn.disabled = meetings.length >= MAX_MEETINGS;
      startBtn.title = meetings.length >= MAX_MEETINGS ? "🛑 Max meetings stored." : "";
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
    })
    .catch(err => console.error("Failed loading meetings:", err));
}

function startMeeting() {
  meetingId = generateMeetingId();
  finalBlob = null;

  startBtn.disabled = true;
  stopBtn.disabled = false;
  statusEl.textContent = "Status: Recording...";
  statusEl.style.color = "red";
  speakerEl.textContent = "Current speaker: —";
  timelineEl.innerHTML = "<em>Listening...</em>";

  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });

    mediaRecorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) finalBlob = e.data;
    };

    mediaRecorder.onstop = () => {
      stopBtn.disabled = true;
      startBtn.disabled = false;
      statusEl.textContent = "Status: Recording stopped.";
      statusEl.style.color = "";

      // Save the full blob as one chunk
      if (finalBlob) {
        const formData = new FormData();
        formData.append('file', finalBlob, `${meetingId}.webm`);
        formData.append('meeting_id', meetingId);
        fetch('/save-chunk', { method: 'POST', body: formData })
          .then(res => res.json())
          .then(json => console.log('✅ Full recording saved:', json))
          .catch(err => console.error('❌ Error saving full recording:', err));
      }

      checkMeetingLimit();
    };

    mediaRecorder.start(); // no timeslice
  });
}

function stopMeeting() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
}

function generateSummaryFor(id) {
  fetch(`/generate-summary/${id}`)
    .then(res => res.json())
    .then(data => {
      timelineEl.innerHTML = "<strong>📄 Meeting Summary:</strong>";
      if (data.transcript) {
        const pre = document.createElement('pre');
        pre.textContent = data.transcript;
        pre.style.border = '1px solid #ccc';
        pre.style.padding = '10px';
        pre.style.whiteSpace = 'pre-wrap';
        pre.style.wordBreak = 'break-word';
        timelineEl.appendChild(pre);
      }
      if (Array.isArray(data.segments)) {
        data.segments.forEach(seg => {
          const div = document.createElement('div');
          div.textContent = `[${formatTime(seg.start)}–${formatTime(seg.end)}] ${seg.speaker} (score: ${seg.score}): ${seg.text}`;
          timelineEl.appendChild(div);
        });
      }
    })
    .catch(err => console.error('❌ Error generating summary:', err));
}

function exportMeeting(id) {
  alert(`🔧 Export for "${id}" not implemented.`);
}

function deleteMeeting(id) {
  fetch(`/delete-meeting/${id}`, { method: 'DELETE' })
    .then(() => checkMeetingLimit());
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = String(Math.floor(sec % 60)).padStart(2, '0');
  return `${m}:${s}`;
}

window.addEventListener('DOMContentLoaded', () => {
  startBtn.disabled = false;
  stopBtn.disabled = true;
  checkMeetingLimit();
});
