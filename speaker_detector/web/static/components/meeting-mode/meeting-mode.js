// /static/components/meeting-mode/meeting-mode.js

import { showMicPopup, hideMicPopup } from "/static/components/mic-popup/mic-popup.js";

let meetingMediaRecorder = null;
let meetingBlob = null;
let meetingId = null;

export function setupMeetingMode() {
  const template = document.getElementById("meeting-mode-template");
  const mount = document.getElementById("meeting-mode-root");

  if (!template || !mount) {
    console.error("❌ Meeting Mode template or root not found");
    return;
  }

  const clone = template.content.cloneNode(true);
  mount.appendChild(clone);

  const startBtn = document.getElementById("start-meeting");
  const stopBtn = document.getElementById("stop-meeting");
  const statusEl = document.getElementById("meeting-status");
  const speakerEl = document.getElementById("speaker-label");
  const timelineEl = document.getElementById("timeline");
  const meetingListEl = document.getElementById("meeting-list");

  if (!startBtn || !stopBtn || !statusEl || !speakerEl || !timelineEl || !meetingListEl) {
    console.error("❌ Meeting Mode UI elements missing");
    return;
  }

  startBtn.onclick = async () => {
    meetingId = new Date().toISOString().replace(/[:.]/g, "-");
    meetingBlob = null;

    startBtn.disabled = true;
    stopBtn.disabled = false;
    statusEl.textContent = "Status: Preparing recording...";
    speakerEl.textContent = "Current speaker: —";
    timelineEl.innerHTML = "<em>🎧 Listening...</em>";

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      meetingMediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });

      meetingMediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) meetingBlob = e.data;
      };

      meetingMediaRecorder.onstop = async () => {
        stopBtn.disabled = true;
        startBtn.disabled = false;
        statusEl.textContent = "Status: Recording stopped.";

        if (meetingBlob) {
          statusEl.textContent = "⏳ Uploading and processing...";
          const formData = new FormData();
          formData.append("file", meetingBlob, `${meetingId}.webm`);
          formData.append("meeting_id", meetingId);

          try {
            await fetch("/api/save-chunk", { method: "POST", body: formData });
            await fetchMeetings(meetingListEl);
            statusEl.textContent = "✅ Meeting saved.";
          } catch (err) {
            console.error("❌ Failed to save meeting:", err);
            statusEl.textContent = "❌ Failed to save meeting.";
          }
        }
      };

      meetingMediaRecorder.start();
      statusEl.textContent = "🔴 Recording meeting...";

    } catch (err) {
      console.error("❌ Microphone access failed:", err);
      statusEl.textContent = "❌ Microphone access denied.";
      startBtn.disabled = false;
    }
  };

  stopBtn.onclick = () => {
    if (meetingMediaRecorder?.state === "recording") {
      meetingMediaRecorder.stop();
    }
  };

  fetchMeetings(meetingListEl);
}

function fetchMeetings(listEl) {
  return fetch("/api/meetings")
    .then((res) => res.json())
    .then((meetings) => {
      if (!Array.isArray(meetings) || meetings.length === 0) {
        listEl.innerHTML = "<em>No meetings found.</em>";
        return;
      }

      listEl.innerHTML = meetings.map((m) => `<li>${m}</li>`).join("");
    })
    .catch((err) => {
      console.error("❌ Failed to fetch meetings:", err);
      listEl.innerHTML = "<li><em>Error loading meetings.</em></li>";
    });
}

