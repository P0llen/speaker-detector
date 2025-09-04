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
  const preview = mount.querySelector('#enroll-preview');
  const progressPillEl = mount.querySelector('#enroll-progress-pill');

  // Load enrollment defaults from backend
  let ENROLL_CLIP_DURATION_S = 7;
  let ENROLL_TARGET_CLIPS = 8;
  fetch('/api/enroll-defaults')
    .then(r => r.json())
    .then(j => {
      if (typeof j.clip_duration_s === 'number') ENROLL_CLIP_DURATION_S = j.clip_duration_s;
      if (typeof j.target_clips === 'number') ENROLL_TARGET_CLIPS = j.target_clips;
      if (progressPillEl) {
        progressPillEl.textContent = `0/${ENROLL_TARGET_CLIPS}`;
        progressPillEl.classList.remove('reached');
      }
    })
    .catch(() => {
      if (progressPillEl) {
        progressPillEl.textContent = `0/${ENROLL_TARGET_CLIPS}`;
        progressPillEl.classList.remove('reached');
      }
    });

  async function refreshProgressFor(name) {
    if (!name) { 
      if (progressPillEl) {
        progressPillEl.textContent = `0/${ENROLL_TARGET_CLIPS}`;
        progressPillEl.classList.remove('reached');
      }
      return; 
    }
    try {
      const list = await fetch('/api/speakers').then(r=>r.json());
      const item = Array.isArray(list) ? list.find(x => (x && x.name) === name) : null;
      const count = item?.recordings || 0;
      const progressPillEl = mount.querySelector('#enroll-progress-pill');
      if (progressPillEl) {
        progressPillEl.textContent = `${count}/${ENROLL_TARGET_CLIPS}`;
        if (count >= ENROLL_TARGET_CLIPS) progressPillEl.classList.add('reached');
        else progressPillEl.classList.remove('reached');
      }
    } catch (e) {
      console.warn('Failed to load speakers for progress', e);
      if (progressPillEl) {
        progressPillEl.textContent = `0/${ENROLL_TARGET_CLIPS || '—'}`;
        progressPillEl.classList.remove('reached');
      }
    }
  }

  // Update progress as the user types a name (debounced)
  let progressTimer;
  speakerInput?.addEventListener('input', () => {
    clearTimeout(progressTimer);
    progressTimer = setTimeout(() => refreshProgressFor(speakerInput.value.trim()), 250);
  });

  enrollBtn.onclick = async () => {
    const id = speakerInput.value.trim();
    if (!id) {
      status.textContent = "❌ Please enter a speaker name.";
      return;
    }

    enrollBtn.disabled = true;
    status.textContent = "🎙️ Preparing microphone...";

    try {
      // Prefer mic set in Mic Test popup
      const preferredId = localStorage.getItem("mic-test-device-id");
      const constraints = preferredId && preferredId !== "default" && preferredId !== "communications"
        ? { audio: { deviceId: { exact: preferredId } } }
        : { audio: true };

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (e) {
        console.warn("Preferred device failed, falling back to default", e);
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      // 3-2-1 countdown before recording
      const countdownEl = document.createElement('div');
      countdownEl.textContent = '⏳ Recording starts in 3...';
      status.insertAdjacentElement('afterend', countdownEl);
      await delayCountdown(countdownEl, 3);
      countdownEl.remove();
      status.textContent = `⏺️ Recording ${ENROLL_CLIP_DURATION_S}s sample... Speak now.`;

      const prefs = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/ogg",
        "audio/mp4",
      ];
      const best = (window.MediaRecorder?.isTypeSupported)
        ? prefs.find(t => MediaRecorder.isTypeSupported(t))
        : null;
      const recorder = best ? new MediaRecorder(stream, { mimeType: best }) : new MediaRecorder(stream);
      const chunks = [];

      recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        try {
          // Close mic right after recording
          try { stream.getTracks().forEach(t => t.stop()); } catch {}

          const blob = new Blob(chunks);
          const url = URL.createObjectURL(blob);

          if (preview) {
            // Build preview UI
            preview.innerHTML = '';
            const audio = document.createElement('audio');
            audio.controls = true;
            audio.src = url;
            audio.style.display = 'block';
            audio.style.marginTop = '6px';

            const actions = document.createElement('div');
            actions.style.marginTop = '8px';
            const useBtn = document.createElement('button');
            useBtn.textContent = '✅ Use This Clip';
            const againBtn = document.createElement('button');
            againBtn.textContent = '↺ Record Again';
            againBtn.style.marginLeft = '8px';
            actions.appendChild(useBtn);
            actions.appendChild(againBtn);

            preview.appendChild(audio);
            preview.appendChild(actions);
            status.textContent = '▶️ Preview your recording, then confirm.';

            // Confirm upload
            useBtn.onclick = async () => {
              useBtn.disabled = true;
              againBtn.disabled = true;
              status.textContent = '⏳ Uploading sample...';
              try {
                const form = new FormData();
                form.append('file', blob, `sample_${Date.now()}.webm`);
                const res = await fetch(`/api/enroll/${encodeURIComponent(id)}`, { method: 'POST', body: form });
                const data = await res.json().catch(() => ({}));
                if (res.ok && (data.status === 'enrolled' || data.ok)) {
                  status.textContent = `✅ Enrolled "${id}". You can add more samples or rebuild.`;
                  setupSpeakersList(speakersRoot);
                  try { URL.revokeObjectURL(url); } catch {}
                  preview.innerHTML = '';
                  refreshProgressFor(id);
                } else {
                  status.textContent = `❌ ${data.error || res.statusText || 'Failed to enroll.'}`;
                  useBtn.disabled = false;
                  againBtn.disabled = false;
                }
              } catch (e) {
                console.error('Upload failed', e);
                status.textContent = '❌ Failed to upload recording.';
                useBtn.disabled = false;
                againBtn.disabled = false;
              } finally {
                enrollBtn.disabled = false;
              }
            };

            // Re-record
            againBtn.onclick = () => {
              try { URL.revokeObjectURL(url); } catch {}
              preview.innerHTML = '';
              status.textContent = 'ℹ️ Click Enroll Speaker to record again.';
              enrollBtn.disabled = false;
            };
          } else {
            // No preview container fallback: upload directly
            const form = new FormData();
            form.append('file', blob, `sample_${Date.now()}.webm`);
            const res = await fetch(`/api/enroll/${encodeURIComponent(id)}`, { method: 'POST', body: form });
            const data = await res.json().catch(() => ({}));
            if (res.ok && (data.status === 'enrolled' || data.ok)) {
              status.textContent = `✅ Enrolled "${id}".`;
              setupSpeakersList(speakersRoot);
              refreshProgressFor(id);
            } else {
              status.textContent = `❌ ${data.error || res.statusText || 'Failed to enroll.'}`;
            }
            enrollBtn.disabled = false;
          }
        } catch (err) {
          console.error("❌ Enroll preview/upload error:", err);
          status.textContent = "❌ Failed after recording.";
          enrollBtn.disabled = false;
        }
      };

      recorder.start();
      setTimeout(() => { try { recorder.stop(); } catch {} }, Math.max(1000, Math.floor(ENROLL_CLIP_DURATION_S * 1000)));

    } catch (err) {
      console.error("❌ Microphone access failed:", err);
      status.textContent = "❌ Microphone access denied.";
      enrollBtn.disabled = false;
    }
  };
}

function delayCountdown(el, seconds) {
  return new Promise(resolve => {
    let count = seconds;
    const interval = setInterval(() => {
      el.textContent = `⏳ Recording starts in ${count--}...`;
      if (count < 0) {
        clearInterval(interval);
        resolve();
      }
    }, 1000);
  });
}


// Auto-run
// setupEnrollSpeaker();
