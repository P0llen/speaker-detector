// ✅ Full script.js with accordion tabs, per-step visualizer, mic test, enroll speaker, combine, export, meetings, recordings

console.log("✅ Full script.js loaded");

let knownSpeakers = [];
let meetingMediaRecorder = null;
let meetingBlob = null;
let meetingId = null;

window.addEventListener("DOMContentLoaded", () => {
  setupAccordionUI();
  setupActions();
  fetchSpeakers();
  fetchRecordings();
  fetchExports();
  fetchMeetings();
});

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = String(Math.floor(sec % 60)).padStart(2, '0');
  return `${m}:${s}`;
}

function setupAccordionUI() {
  document.querySelectorAll('.accordion-step').forEach(step => {
    step.addEventListener('click', () => {
      document.querySelectorAll('.accordion-step').forEach(s => s.classList.remove('active'));
      document.querySelectorAll('.accordion-content').forEach(c => c.classList.remove('active'));
      step.classList.add('active');
      document.getElementById(step.dataset.tab).classList.add('active');
    });
  });
}

function setupActions() {
  document.getElementById('action-btn')?.addEventListener('click', runMicTest);
  document.getElementById('enroll-speaker-btn')?.addEventListener('click', enrollSpeaker);
  document.getElementById('identify-speaker-btn')?.addEventListener('click', identifySpeaker);
  document.getElementById('combine-embeddings-btn')?.addEventListener('click', combineEmbeddings);
  document.getElementById('export-json-btn')?.addEventListener('click', exportJSON);
  document.getElementById('start-meeting')?.addEventListener('click', startMeeting);
  document.getElementById('stop-meeting')?.addEventListener('click', stopMeeting);
}

function getSpeakerPrompt() {
  return `
    Please read the following aloud for speaker enrollment:
    "The quick brown fox jumps over the lazy dog. This sentence contains every letter of the alphabet, offering a rich variety of sounds. Speak naturally, with your normal tone and pace."
  `.trim();
}

///////// -------------- /////////////


function runMicTest() {
  const resultEl = document.getElementById('identify-result');
  resultEl.innerHTML = "Testing microphone...";

  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    const canvas = document.querySelector('.accordion-content.active .visualizer');
    if (canvas) setupVisualizer(stream, canvas);

    const recorder = new MediaRecorder(stream);
    const chunks = [];

    recorder.ondataavailable = e => chunks.push(e.data);

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const url = URL.createObjectURL(blob);

      resultEl.innerHTML = `✅ Mic test successful.<br><audio controls src="${url}"></audio>`;

      const micTestStatus = document.getElementById('mic-test-status');
      if (micTestStatus) micTestStatus.textContent = "✅ Passed";

      stream.getTracks().forEach(t => t.stop());
    };

    recorder.start();
    setTimeout(() => recorder.stop(), 3000);
  });
}


function setupVisualizer(stream, canvas) {
  const audioCtx = new AudioContext();
  const analyser = audioCtx.createAnalyser();
  const source = audioCtx.createMediaStreamSource(stream);
  source.connect(analyser);

  const canvasCtx = canvas.getContext('2d');
  analyser.fftSize = 2048;
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function draw() {
    requestAnimationFrame(draw);
    analyser.getByteTimeDomainData(dataArray);

    canvasCtx.fillStyle = '#111';
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = 'lime';
    canvasCtx.beginPath();

    const sliceWidth = canvas.width / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * canvas.height) / 2;
      if (i === 0) canvasCtx.moveTo(x, y);
      else canvasCtx.lineTo(x, y);
      x += sliceWidth;
    }

    canvasCtx.lineTo(canvas.width, canvas.height / 2);
    canvasCtx.stroke();
  }

  draw();
}

function enrollSpeaker() {
  const id = document.getElementById("speaker-id").value.trim();
  if (!id) return alert("Please enter speaker ID");

  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    const chunks = [];

    recorder.ondataavailable = e => chunks.push(e.data);

    recorder.onstop = async () => {
      const blob = new Blob(chunks);
      const url = URL.createObjectURL(blob);

      // ✅ Show preview UI
      const previewDiv = document.createElement("div");
      previewDiv.innerHTML = `
        <h4>🎧 Preview your enrollment for "${id}"</h4>
        <audio controls src="${url}"></audio>
        <button id="confirm-enroll-btn">✅ Confirm Enrollment</button>
        <button id="discard-enroll-btn">❌ Discard</button>
      `;
      document.body.appendChild(previewDiv);

      document.getElementById("confirm-enroll-btn").onclick = async () => {
        const form = new FormData();
        form.append("file", blob, `enroll_${Date.now()}.webm`);

        const res = await fetch(`/api/enroll/${encodeURIComponent(id)}`, {
          method: "POST",
          body: form
        });

        const data = await res.json();
        if (data.status === "enrolled") {
          alert(`✅ Enrolled "${id}".`);
          fetchSpeakers();
        } else {
          alert(`❌ Enroll failed: ${data.error}`);
        }

        previewDiv.remove();
      };

      document.getElementById("discard-enroll-btn").onclick = () => {
        alert("🚫 Discarded recording.");
        previewDiv.remove();
      };

      stream.getTracks().forEach(t => t.stop());
    };

    recorder.start();
    alert("🎙️ Recording for 20 seconds. Please read the provided text aloud...");
    setTimeout(() => recorder.stop(), 20000);
  });
}


function renameSpeaker(oldName) {
  const newName = prompt(`Rename "${oldName}" to:`, oldName);
  if (!newName || newName === oldName) return;

  fetch(`/api/speakers/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oldName, newName })
  })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        alert(`✅ Renamed to "${newName}".`);
        fetchSpeakers();
      } else {
        alert(`❌ Rename failed: ${data.error}`);
      }
    });
}

function deleteSpeaker(speakerId) {
  if (!confirm(`Are you sure you want to delete "${speakerId}"?`)) return;

  fetch(`/api/speakers/${encodeURIComponent(speakerId)}`, { method: "DELETE" })
    .then(res => res.json())
    .then(data => {
      if (data.deleted) {
        alert(`🗑️ Deleted "${speakerId}"`);
        fetchSpeakers();
      } else {
        alert(`❌ Delete failed: ${data.error}`);
      }
    });
}

function improveSpeaker(speakerId) {
  alert(`🎤 Let's improve data for "${speakerId}".\n\nYou'll be prompted to record a longer sample.`);
  enrollSpeakerWithGuidance(speakerId); // Use your new improved enrollment function from earlier
}


async function identifySpeaker() {
  const resultEl = document.getElementById('identify-result-step-3') || document.getElementById('identify-result');
  const canvas = document.querySelector('#step-3 .visualizer');
  const promptText = getSpeakerPrompt();

  // Show prompt and prepare UI
  resultEl.innerHTML = `
    <p>${promptText}</p>
    <p>🎙️ Preparing to record for speaker identification...</p>
  `;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (canvas) setupVisualizer(stream, canvas);

    // Countdown
    const countdownEl = document.createElement('div');
    countdownEl.textContent = "Recording will start in 3...";
    resultEl.appendChild(countdownEl);

    await delayCountdown(countdownEl, 3);

    // Recording for 5s (you can adjust this)
    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    const chunks = [];

    recorder.ondataavailable = e => chunks.push(e.data);

    recorder.onstop = async () => {
      const blob = new Blob(chunks);
      const url = URL.createObjectURL(blob);

      // Send to backend
      resultEl.innerHTML = `<p>⏳ Sending to backend...</p>`;
      const form = new FormData();
      form.append("file", blob, "identify.webm");

      try {
        const res = await fetch("/api/identify", { method: "POST", body: form });
        const { speaker, score, error } = await res.json();

        resultEl.innerHTML = error
          ? `❌ ${error}`
          : `🗣️ Speaker: <strong class="segment-speaker">${speaker}</strong> (score: ${score})<br><audio controls src="${url}"></audio>`;

        // Correction button
        const feedbackBtn = document.createElement("button");
        feedbackBtn.textContent = "✏️ Correct Speaker";
        feedbackBtn.style.marginLeft = "10px";
        feedbackBtn.onclick = () => {
          showCorrectionUI(blob, resultEl);
        };
        resultEl.appendChild(feedbackBtn);

      } catch (err) {
        console.error(err);
        resultEl.innerHTML = `❌ Failed to identify speaker.`;
      }

      stream.getTracks().forEach(t => t.stop());
    };

    recorder.start();
    countdownEl.textContent = "🎙️ Recording... Speak now.";
    setTimeout(() => recorder.stop(), 5000);

  } catch (err) {
    console.error(err);
    resultEl.innerHTML = "❌ Failed to access microphone.";
  }
}

// Utility to delay with countdown
function delayCountdown(el, seconds) {
  return new Promise(resolve => {
    let count = seconds;
    const interval = setInterval(() => {
      el.textContent = `Recording will start in ${count}...`;
      count--;
      if (count < 0) {
        clearInterval(interval);
        resolve();
      }
    }, 1000);
  });
}

// Shared correction UI
function showCorrectionUI(blob, container) {
  const wrapper = document.createElement("div");
  wrapper.style.marginTop = "0.5rem";

  const label = document.createElement("label");
  label.textContent = "Correct speaker: ";

  const input = document.createElement("input");
  input.placeholder = "e.g. Lara or new...";
  input.style.width = "200px";

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = "✅ Confirm";
  confirmBtn.style.marginLeft = "0.5rem";

  confirmBtn.onclick = async () => {
    const correctedName = input.value.trim();
    if (!correctedName) return alert("Please enter a name.");

    const uploadForm = new FormData();
    uploadForm.append("file", blob, `identify_${Date.now()}.webm`);

    const res = await fetch(`/api/enroll/${encodeURIComponent(correctedName)}`, {
      method: "POST",
      body: uploadForm,
    });

    const data = await res.json();
    if (data.status === "enrolled") {
      alert(`✅ Reclassified and enrolled as "${correctedName}".`);
      fetchSpeakers();
    } else {
      alert("❌ Correction failed.");
    }
  };

  wrapper.appendChild(label);
  wrapper.appendChild(input);
  wrapper.appendChild(confirmBtn);
  container.appendChild(wrapper);
}





function exportSpeakersJSON() {
  fetch("/api/export-speakers-json", { method: "POST" }).then(res => {
    document.getElementById("export-json-status").textContent = res.ok ? "✅ Combined & Exported" : "❌ Failed";
    fetchExports();
  });
}


function fetchSpeakers() {
  fetch("/api/speakers")
    .then(res => res.json())
    .then(data => {
      const list = document.getElementById("speakers-list");
      list.innerHTML = data.map(id => `
        <li>
          ${id}
          <button onclick="renameSpeaker('${id}')">✏️ Rename</button>
          <button onclick="deleteSpeaker('${id}')">🗑️ Delete</button>
          <button onclick="improveSpeaker('${id}')">🔁 Improve</button>
        </li>
      `).join("") || "<li><em>No speakers enrolled.</em></li>";
    });
}

function showMicOverlay({ title, message, countdownSeconds = 3, onStop, onStreamReady }) {
  // Create overlay
  const overlay = document.createElement("div");
  overlay.className = "mic-overlay";
  overlay.innerHTML = `
    <div class="overlay-content">
      <h2>${title}</h2>
      <p>${message}</p>
      <p id="mic-countdown">⏳ Starting in ${countdownSeconds}...</p>
      <button id="cancel-overlay">❌ Cancel</button>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById("cancel-overlay").onclick = () => {
    overlay.remove();
  };

  // Request microphone access and prepare recorder
  navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    const countdownEl = document.getElementById("mic-countdown");
    let count = countdownSeconds;

    const interval = setInterval(() => {
      countdownEl.textContent = `⏳ Starting in ${count--}...`;
      if (count < 0) {
        clearInterval(interval);
        countdownEl.textContent = "🎙️ Recording...";
        const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
        const chunks = [];

        recorder.ondataavailable = (e) => chunks.push(e.data);

        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: "audio/webm" });
          onStop?.(blob);
        };

        onStreamReady?.(stream, () => recorder.stop());

        recorder.start();

        // Default 20s stop if no manual trigger
        setTimeout(() => {
          if (recorder.state === "recording") recorder.stop();
        }, 20000);
      }
    }, 1000);
  });
}

function closeMicOverlay() {
  document.querySelector(".mic-overlay")?.remove();
}


// New: Improve speaker prompt and upload
function improveSpeaker(speakerId) {
  showMicOverlay({
    title: `🔁 Improve Speaker: "${speakerId}"`,
    message: getSpeakerPrompt(),
    countdownSeconds: 20,
    onStop: (blob) => {
      const url = URL.createObjectURL(blob);

      const previewDiv = document.createElement("div");
      previewDiv.classList.add("overlay-content");
      previewDiv.innerHTML = `
        <h4>🎧 Preview your improved recording for "${speakerId}"</h4>
        <audio controls src="${url}"></audio>
        <button id="confirm-improve-btn">✅ Confirm Upload</button>
        <button id="discard-improve-btn">❌ Discard</button>
      `;
      document.body.appendChild(previewDiv);

      document.getElementById("confirm-improve-btn").onclick = async () => {
        const form = new FormData();
        form.append("file", blob, `improve_${Date.now()}.webm`);

        const res = await fetch(`/api/speakers/${encodeURIComponent(speakerId)}/improve`, {
          method: "POST",
          body: form,
        });

        const data = await res.json();
        if (data.status === "improved") {
          alert(`✅ Improved recording added to "${speakerId}".`);
        } else {
          alert(`❌ Improve failed: ${data.error}`);
        }

        previewDiv.remove();
        closeMicOverlay();
      };

      document.getElementById("discard-improve-btn").onclick = () => {
        alert("🚫 Discarded recording.");
        previewDiv.remove();
        closeMicOverlay();
      };
    },
  });
}




function renameSpeaker(id) {
  const newName = prompt(`Rename speaker "${id}" to:`);
  if (!newName || newName === id) return;

  fetch(`/api/speakers/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oldName: id, newName }),
  })
    .then(res => res.json())
    .then(data => {
      if (data.status === "renamed") {
        alert(`✅ Renamed to ${data.to}`);
        fetchSpeakers();
      } else {
        alert(`❌ Failed: ${data.error}`);
      }
    });
}

function deleteSpeaker(id) {
  if (!confirm(`Delete speaker "${id}"?`)) return;

  fetch(`/api/speakers/${encodeURIComponent(id)}`, { method: "DELETE" })
    .then(res => res.json())
    .then(data => {
      if (data.deleted) {
        alert(`✅ Deleted "${id}"`);
        fetchSpeakers();
      } else {
        alert(`❌ Failed`);
      }
    });
}



function fetchRecordings() {
  fetch("/api/recordings")
    .then(res => res.json())
    .then(data => {
      const list = document.getElementById("recordings-list");
      const speakers = Object.keys(data);
      list.innerHTML = speakers.length
        ? speakers.map(s => `<li><strong>${s}</strong></li>`).join("")
        : "<li><em>No recordings available.</em></li>";
    });
}

function fetchExports() {
  fetch('/api/exports')
    .then(res => res.json())
    .then(data => {
      const list = document.getElementById('exports-list');
      if (data.length === 0) {
        list.innerHTML = '<li><em>No exports yet.</em></li>';
        return;
      }

      list.innerHTML = '';
      data.forEach(file => {
        const li = document.createElement('li');
        li.innerHTML = `
          ${file}
          <button onclick="downloadExport('${file}')">⬇️ Download</button>
          <button onclick="deleteExport('${file}')">🗑️ Delete</button>
        `;
        list.appendChild(li);
      });
    });
}

function downloadExport(filename) {
  const link = document.createElement('a');
  link.href = `/exports/${filename}`;
  link.download = filename;
  link.click();
}

function deleteExport(filename) {
  if (!confirm(`Delete ${filename}?`)) return;

  fetch(`/api/delete-export/${encodeURIComponent(filename)}`, { method: 'DELETE' })
    .then(res => res.json())
    .then(data => {
      if (data.deleted) {
        alert(`✅ Deleted ${filename}`);
        fetchExports();
      } else {
        alert(`❌ Failed: ${data.error}`);
      }
    });
}

function startMeeting() {
  const startBtn = document.getElementById("start-meeting");
  const stopBtn = document.getElementById("stop-meeting");
  const statusEl = document.getElementById("meeting-status");
  const speakerEl = document.getElementById("speaker-label");
  const timelineEl = document.getElementById("timeline");

  meetingId = new Date().toISOString().replace(/[:.]/g, "-");
  meetingBlob = null;

  startBtn.disabled = true;
  stopBtn.disabled = false;
  statusEl.textContent = "Status: Preparing recording...";
  statusEl.style.color = "red";
  speakerEl.textContent = "Current speaker: —";
  timelineEl.innerHTML = "<em>🎧 Listening...</em>";

  showMicOverlay({
    title: "🎙️ Meeting Mode",
    message: "Capturing meeting audio... Meeting mode will continue until you stop it manually.",
    countdownSeconds: 3,
    onStop: (blob) => {
      // This function will be called when stopMeeting is invoked
    },
    onStreamReady: (stream, stopOverlayRecording) => {
      meetingMediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });

      meetingMediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) meetingBlob = e.data;
      };

      meetingMediaRecorder.onstop = async () => {
        stopBtn.disabled = true;
        startBtn.disabled = false;
        statusEl.textContent = "Status: Recording stopped.";
        statusEl.style.color = "";

        if (meetingBlob) {
          statusEl.textContent = "⏳ Uploading and processing...";
          const formData = new FormData();
          formData.append("file", meetingBlob, `${meetingId}.webm`);
          formData.append("meeting_id", meetingId);

          try {
            await fetch("/api/save-chunk", { method: "POST", body: formData });
            fetchMeetings();
            statusEl.textContent = "✅ Meeting saved.";
          } catch (err) {
            console.error("❌ Failed to save meeting:", err);
            statusEl.textContent = "❌ Failed to save meeting.";
          } finally {
            closeMicOverlay();
          }
        }
      };

      meetingMediaRecorder.start();
      statusEl.textContent = "🔴 Recording meeting...";
    },
  });
}

function stopMeeting() {
  if (meetingMediaRecorder?.state === "recording") {
    meetingMediaRecorder.stop();
  }
}


function fetchMeetings() {
  fetch("/api/meetings")
    .then((res) => res.json())
    .then((meetings) => {
      const container = document.getElementById("meeting-list");
      if (meetings.length === 0) {
        container.innerHTML = "<em>No meetings saved yet.</em>";
        return;
      }

      container.innerHTML = "";
      meetings.forEach((id) => {
        const div = document.createElement("div");
        div.innerHTML = `
          <strong>${id}</strong>
          <button onclick="generateSummaryFor('${id}')">📄 Summary</button>
          <button onclick="deleteMeeting('${id}')">🗑️ Delete</button>
        `;
        container.appendChild(div);
      });
    });
}

async function generateSummaryFor(meetingId) {
  const timelineEl = document.getElementById("timeline");
  timelineEl.innerHTML = "<strong>📄 Loading summary...</strong>";

  try {
    const res = await fetch(`/api/generate-summary/${meetingId}`);
    const data = await res.json();

    timelineEl.innerHTML = "<strong>📄 Meeting Summary:</strong>";

    if (data.transcript) {
      const pre = document.createElement("pre");
      pre.textContent = data.transcript;
      pre.style.marginBottom = "1rem";
      timelineEl.appendChild(pre);
    }

    if (Array.isArray(data.segments)) {
      data.segments.forEach((seg) => {
        const div = document.createElement("div");
        div.className = "segment-block";
        div.innerHTML = `
          <div class="segment-meta">
            <span class="segment-time">[${formatTime(seg.start)}–${formatTime(seg.end)}]</span>
            <span class="segment-speaker">${seg.speaker}</span>
            <span class="segment-score">(${(seg.score ?? 0).toFixed(2)})</span>
          </div>
          <blockquote class="segment-text">${seg.text}</blockquote>
        `;

        const feedbackBtn = document.createElement("button");
        feedbackBtn.textContent = "✏️ Correct Speaker";
        feedbackBtn.style.marginLeft = "10px";

        feedbackBtn.onclick = () => {
          const wrapper = document.createElement("div");
          wrapper.style.marginTop = "0.5rem";

          const label = document.createElement("label");
          label.textContent = "Correct speaker: ";
          label.style.marginRight = "0.5rem";

          const input = document.createElement("input");
          input.setAttribute("list", "speaker-options");
          input.placeholder = "e.g. Lara or new...";
          input.style.width = "200px";

          const dataList = document.createElement("datalist");
          dataList.id = "speaker-options";
          knownSpeakers.forEach((name) => {
            const opt = document.createElement("option");
            opt.value = name;
            dataList.appendChild(opt);
          });

          const confirmBtn = document.createElement("button");
          confirmBtn.textContent = "✅ Confirm";
          confirmBtn.style.marginLeft = "0.5rem";

          confirmBtn.onclick = async () => {
            const correctedName = input.value.trim();
            if (!correctedName) return alert("Please enter a name.");

            feedbackBtn.disabled = true;
            confirmBtn.disabled = true;
            confirmBtn.textContent = "⏳ Correcting...";

            try {
              const payload = {
                old_speaker: seg.speaker,
                correct_speaker: correctedName,
                filename: seg.filename || ""  // Ensure filename is returned by backend
              };

              const res = await fetch("/api/correct-segment", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              });

              if (res.ok) {
                div.querySelector(".segment-speaker").textContent = correctedName;
                alert(`✅ Reclassified to ${correctedName}`);
                fetchSpeakers();
              } else {
                alert("❌ Correction failed.");
              }
            } catch (err) {
              alert(`❌ Error: ${err}`);
            } finally {
              wrapper.remove();
            }
          };

          wrapper.appendChild(label);
          wrapper.appendChild(input);
          wrapper.appendChild(dataList);
          wrapper.appendChild(confirmBtn);
          div.appendChild(wrapper);
        };

        div.appendChild(feedbackBtn);
        timelineEl.appendChild(div);
      });
    } else {
      timelineEl.innerHTML += "<p><em>No segments found.</em></p>";
    }
  } catch (err) {
    console.error("❌ Failed to generate summary:", err);
    timelineEl.innerHTML = "<strong>❌ Failed to load summary.</strong>";
  }
}



function deleteMeeting(meetingId) {
  if (!confirm(`Delete meeting: ${meetingId}?`)) return;

  fetch(`/api/delete-meeting/${meetingId}`, { method: "DELETE" })
    .then((res) => res.json())
    .then((data) => {
      if (data.deleted) {
        alert(`✅ Deleted ${meetingId}`);
        fetchMeetings();
      } else {
        alert(`❌ Failed: ${data.error}`);
      }
    });
}


