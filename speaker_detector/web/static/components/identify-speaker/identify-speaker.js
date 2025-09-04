// /static/components/identify-speaker/identify-speaker.js
import { getSpeakerPrompt } from "/static/scripts/utils/prompt.js";
import { showCorrectionUI } from "/static/components/correction/correction.js";

export function setupIdentifySpeaker() {
const template = document.getElementById("identify-speaker-template");
const mount = document.getElementById("identify-speaker-root");

  if (!template || !mount) {
    console.error("❌ Identify Speaker template or step mount not found");
    return;
  }

  // Avoid remounting
  if (mount.querySelector("#identify-speaker-btn")) return;

  const clone = template.content.cloneNode(true);
  mount.appendChild(clone);

  const btn = mount.querySelector("#identify-speaker-btn");
  const canvas = mount.querySelector(".visualizer");
  const resultEl = mount.querySelector("#identify-result-step-3");
  // Live detection controls
  const liveToggleBtn = mount.querySelector("#live-toggle-btn");
  const liveStatusEl = mount.querySelector("#live-status");
  const liveSpeakerEl = mount.querySelector("#live-speaker");
  const liveConfEl = mount.querySelector("#live-confidence");
  const liveIsSpeakingEl = mount.querySelector("#live-isspeaking");
  const liveBackendStatusEl = mount.querySelector("#live-backend-status");
  const liveSuggestedEl = mount.querySelector("#live-suggested");
  const resetDefaultsBtn = mount.querySelector('#reset-defaults-btn');
  // Sliders
  const thresholdSlider = mount.querySelector('#threshold-slider');
  const intervalSlider = mount.querySelector('#interval-slider');
  const windowSlider = mount.querySelector('#window-slider');
  const unknownSlider = mount.querySelector('#unknown-slider');
  const holdSlider = mount.querySelector('#hold-slider');
  const thresholdVal = mount.querySelector('#threshold-value');
  const intervalVal = mount.querySelector('#interval-value');
  const windowVal = mount.querySelector('#window-value');
  const unknownVal = mount.querySelector('#unknown-value');
  const holdVal = mount.querySelector('#hold-value');
  // Background rebuild controls
  const rebuildBgBtn = mount.querySelector('#rebuild-background-btn');
  const rebuildBgStatus = mount.querySelector('#rebuild-background-status');

  // Helper: reset Identify UI to initial state without page reload
  const resetIdentifyUI = () => {
    try {
      // Stop any playing audio in the identify result area
      resultEl.querySelectorAll('audio').forEach(a => { try { a.pause(); } catch {} });
    } catch {}
    resultEl.innerHTML = 'Awaiting action...';
  };

  if (!btn || !resultEl) return;

  btn.onclick = async () => {
    const prompt = getSpeakerPrompt();
    resultEl.innerHTML = `
      <p class="mic-instruction">${prompt}</p>
      <p>🎙️ Preparing to record for identification...</p>
    `;

    try {
      // Prefer the mic selected in Mic Test popup
      const preferredId = localStorage.getItem("mic-test-device-id");
      const constraints = preferredId && preferredId !== "default" && preferredId !== "communications"
        ? { audio: { deviceId: { exact: preferredId } } }
        : { audio: true };
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (e) {
        console.warn("getUserMedia with preferred device failed, falling back to default", e);
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      let stopVisualizer;
      if (canvas) stopVisualizer = setupVisualizer(stream, canvas);

      const countdownEl = document.createElement("div");
      countdownEl.textContent = "Recording will start in 3...";
      resultEl.appendChild(countdownEl);
      await delayCountdown(countdownEl, 3);

      // Choose best-supported mime
      const prefs = ["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus","audio/ogg","audio/mp4"]; 
      const best = (window.MediaRecorder?.isTypeSupported) ? prefs.find(t => MediaRecorder.isTypeSupported(t)) : null;
      const recorder = best ? new MediaRecorder(stream, { mimeType: best }) : new MediaRecorder(stream);
      const chunks = [];

      recorder.ondataavailable = e => chunks.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(chunks);
        const url = URL.createObjectURL(blob);
        resultEl.innerHTML = `<p>⏳ Uploading recording...</p>`;

        const form = new FormData();
        form.append("file", blob, "identify.webm");

        try {
          const res = await fetch("/api/identify", { method: "POST", body: form });
          const { speaker, score, error, suggested, improved } = await res.json();

          if (error) {
            resultEl.innerHTML = `❌ ${error}`;
          } else {
            const parts = [];
            parts.push(`🗣️ <strong>${speaker}</strong> (score: ${Number(score).toFixed(2)})`);
            if (suggested && (speaker === 'unknown' || suggested.speaker !== speaker)) {
              parts.push(`<div class="hint">💡 Suggested: <strong>${suggested.speaker}</strong> (${Number(suggested.confidence).toFixed(2)})</div>`);
            }
            if (improved) {
              parts.push(`<div class="ok">✅ Added this sample to ${speaker}</div>`);
            }
            parts.push(`<audio controls src="${url}"></audio>`);
            resultEl.innerHTML = parts.join("<br>");

            // Action buttons
            const btnBar = document.createElement("div");
            btnBar.style.marginTop = "8px";
            const msgBar = document.createElement('div');
            msgBar.className = 'action-messages';
            msgBar.style.marginTop = '6px';

            // Accept & Improve when we have a concrete non-background prediction
            const isPredBackground = (speaker || '').toLowerCase() === 'background' || (speaker || '').toLowerCase() === 'background_noise';
            if (speaker && speaker !== 'unknown' && !isPredBackground) {
              const acceptBtn = document.createElement('button');
              acceptBtn.textContent = `👍 Accept & Improve ${speaker}`;
              acceptBtn.onclick = async () => {
                try {
                  const form2 = new FormData();
                  form2.append('file', blob, `improve_${Date.now()}.webm`);
                  const res2 = await fetch(`/api/speakers/${encodeURIComponent(speaker)}/improve`, { method: 'POST', body: form2 });
                  const j2 = await res2.json();
                  if (j2 && j2.status === 'improved') {
                    acceptBtn.disabled = true;
                    acceptBtn.textContent = '✅ Improved';
                    const note = document.createElement('div');
                    note.className = 'ok';
                    note.textContent = `Added clip to ${speaker}. Consider rebuilding.`;
                    msgBar.appendChild(note);
                  }
                } catch (e) { console.error('Improve failed', e); }
              };
              btnBar.appendChild(acceptBtn);
            }

            // Correct Speaker button (existing)
            const feedbackBtn = document.createElement("button");
            feedbackBtn.textContent = "✏️ Correct Speaker";
            feedbackBtn.style.marginLeft = "10px";
            feedbackBtn.onclick = () => showCorrectionUI(blob, resultEl);
            btnBar.appendChild(feedbackBtn);

            // Dynamic "Accept suggestion" button (omit if suggestion equals prediction)
            if (suggested?.speaker) {
              const name = suggested.speaker;
              const isBg = (name || '').toLowerCase() === 'background' || (name || '').toLowerCase() === 'background_noise';
              const sameAsPrediction = ((speaker || '').toLowerCase() === (name || '').toLowerCase());
              if (!sameAsPrediction) {
              const suggBtn = document.createElement('button');
              suggBtn.textContent = isBg ? '🌫️ Accept as Background Noise' : `➕ Accept Suggestion: ${name}`;
              suggBtn.style.marginLeft = '10px';
              suggBtn.onclick = async () => {
                try {
                  if (isBg) {
                    const fd = new FormData();
                    fd.append('audio', blob, `bg_${Date.now()}.webm`);
                    const r = await fetch('/api/background_noise', { method: 'POST', body: fd });
                    const j = await r.json();
                    if (r.ok && j.success) {
                      suggBtn.disabled = true; suggBtn.textContent = '✅ Background added';
                      const note = document.createElement('div');
                      note.className = 'ok';
                      note.textContent = 'Background sample added. Click Rebuild Background below to update the model.';
                      msgBar.appendChild(note);
                    } else {
                      alert(`Failed to save background: ${j.error || r.statusText}`);
                    }
                    return;
                  }

                  const target = prompt('Confirm speaker name:', name) || name;
                  if (!target) return;
                  const names = await fetch('/api/speakers/list-names').then(r=>r.json()).then(j=>j.speakers||[]);
                  const form3 = new FormData(); form3.append('file', blob, `sample_${Date.now()}.webm`);
                  if (names.includes(target)) {
                    await fetch(`/api/speakers/${encodeURIComponent(target)}/improve`, { method: 'POST', body: form3 });
                  } else {
                    await fetch(`/api/enroll/${encodeURIComponent(target)}`, { method: 'POST', body: form3 });
                  }
                  suggBtn.disabled = true; suggBtn.textContent = '✅ Saved';
                  const note = document.createElement('div');
                  note.className = 'ok';
                  note.textContent = `Saved clip to ${target}. Consider rebuilding.`;
                  msgBar.appendChild(note);
                } catch (e) { console.error('Accept suggestion failed', e); }
              };
              btnBar.appendChild(suggBtn);
              }
            }

            // Always allow forcing background save
            const forceBgBtn = document.createElement('button');
            forceBgBtn.textContent = '🌫️ Save as Background Noise';
            forceBgBtn.style.marginLeft = '10px';
            forceBgBtn.onclick = async () => {
              try {
                const fd = new FormData();
                fd.append('audio', blob, `bg_${Date.now()}.webm`);
                const r = await fetch('/api/background_noise', { method: 'POST', body: fd });
                const j = await r.json();
                if (r.ok && j.success) {
                  forceBgBtn.disabled = true; forceBgBtn.textContent = '✅ Background added';
                  const note = document.createElement('div');
                  note.className = 'ok';
                  note.textContent = 'Background sample added. Click Rebuild Background below to update the model.';
                  msgBar.appendChild(note);
                } else {
                  alert(`Failed to save background: ${j.error || r.statusText}`);
                }
              } catch (e) { console.error('Force background failed', e); }
            };
            btnBar.appendChild(forceBgBtn);

            resultEl.appendChild(btnBar);
            resultEl.appendChild(msgBar);
          }

        } catch (err) {
          console.error("❌ API Error:", err);
          resultEl.innerHTML = "❌ Failed to identify speaker.";
        }

        stopVisualizer?.();
        stream.getTracks().forEach(t => t.stop());
      };

      countdownEl.textContent = "🎙️ Recording... Speak now.";
      recorder.start();
      setTimeout(() => recorder.stop(), 5000);

    } catch (err) {
      console.error("❌ Microphone access failed:", err);
      resultEl.innerHTML = "❌ Failed to access microphone.";
    }
  };

  // ---- Live detection wiring ----
  let pollTimer = null;
  let currentSettings = null;

  const fetchSettings = async () => {
    const res = await fetch('/api/listening-mode');
    currentSettings = await res.json();
    // Initialize sliders and readouts
    const t = currentSettings.threshold ?? 0.75;
    const i = currentSettings.interval_ms ?? 3000;
    const w = currentSettings.window_s ?? 1.25;
    const u = currentSettings.unknown_streak_limit ?? 2;
    const h = currentSettings.hold_ttl_s ?? 4.0;
    thresholdSlider.value = t;
    intervalSlider.value = i;
    windowSlider.value = w;
    unknownSlider.value = u;
    holdSlider.value = h;
    thresholdVal.textContent = Number(t).toFixed(2);
    intervalVal.textContent = `${i}`;
    windowVal.textContent = Number(w).toFixed(2);
    unknownVal.textContent = `${u}`;
    holdVal.textContent = Number(h).toFixed(1);
    liveStatusEl.textContent = `Status: ${currentSettings.mode === 'off' ? 'idle' : 'listening'}`;
    liveToggleBtn.textContent = currentSettings.mode === 'off' ? '▶️ Start Live' : '⏹️ Stop Live';
    if (resetDefaultsBtn) resetDefaultsBtn.disabled = false;
  };

  const debouncedPost = (() => {
    let t;
    return (payload) => {
      clearTimeout(t);
      t = setTimeout(async () => {
        try {
          await fetch('/api/listening-mode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
        } catch (e) {
          console.error('Failed to update settings', e);
        }
      }, 150);
    };
  })();

  const applySettingsFromSliders = (overrides = {}) => {
    const payload = {
      threshold: parseFloat(thresholdSlider.value),
      interval_ms: parseInt(intervalSlider.value, 10),
      window_s: parseFloat(windowSlider.value),
      unknown_streak_limit: parseInt(unknownSlider.value, 10),
      hold_ttl_s: parseFloat(holdSlider.value),
      ...overrides,
    };
    // Update labels immediately
    thresholdVal.textContent = Number(payload.threshold).toFixed(2);
    intervalVal.textContent = `${payload.interval_ms}`;
    windowVal.textContent = Number(payload.window_s).toFixed(2);
    unknownVal.textContent = `${payload.unknown_streak_limit}`;
    holdVal.textContent = Number(payload.hold_ttl_s).toFixed(1);
    debouncedPost(payload);
  };

  // Slider change handlers
  [thresholdSlider, intervalSlider, windowSlider, unknownSlider, holdSlider].forEach((el) => {
    el?.addEventListener('input', () => applySettingsFromSliders());
  });

  const startPolling = () => {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      try {
        const res = await fetch('/api/active-speaker');
        const data = await res.json();
        liveSpeakerEl.textContent = data.speaker ?? '—';
        liveConfEl.textContent = (data.confidence ?? 0).toFixed(2);
        liveIsSpeakingEl.textContent = data.is_speaking ? 'yes' : 'no';
        liveBackendStatusEl.textContent = data.status ?? '—';
        const sugg = data.suggested && data.suggested.speaker ? `${data.suggested.speaker} (${Number(data.suggested.confidence||0).toFixed(2)})` : '—';
        if (liveSuggestedEl) liveSuggestedEl.textContent = sugg;
      } catch (e) {
        console.error('Polling /api/active-speaker failed', e);
      }
    }, 500);
  };

  const stopPolling = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  };

  const startLive = async () => {
    liveToggleBtn.disabled = true;
    applySettingsFromSliders({ mode: 'single' });
    setTimeout(() => {
      liveStatusEl.textContent = 'Status: listening';
      liveToggleBtn.textContent = '⏹️ Stop Live';
      liveToggleBtn.disabled = false;
      startPolling();
    }, 200);
  };

  const stopLive = async () => {
    liveToggleBtn.disabled = true;
    try {
      await fetch('/api/listening-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'off' })
      });
    } catch (e) {
      console.error('Failed to stop live', e);
    }
    liveStatusEl.textContent = 'Status: idle';
    liveToggleBtn.textContent = '▶️ Start Live';
    liveToggleBtn.disabled = false;
    stopPolling();
  };

  liveToggleBtn?.addEventListener('click', () => {
    if (liveToggleBtn.textContent.includes('Start')) startLive();
    else stopLive();
  });

  // Initialize from backend on mount
  fetchSettings();

  // Reset to defaults handler
  resetDefaultsBtn?.addEventListener('click', () => {
    const d = (currentSettings && currentSettings.defaults) || null;
    if (!d) return;
    thresholdSlider.value = d.threshold;
    intervalSlider.value = d.interval_ms;
    windowSlider.value = d.window_s;
    unknownSlider.value = d.unknown_streak_limit;
    holdSlider.value = d.hold_ttl_s;
    applySettingsFromSliders();
  });

  // Rebuild background handler
  rebuildBgBtn?.addEventListener('click', async () => {
    rebuildBgBtn.disabled = true;
    rebuildBgStatus.textContent = 'Rebuilding...';

    // Create/attach progress bar
    let progress = mount.querySelector('.bg-rebuild-progress');
    if (!progress) {
      progress = document.createElement('div');
      progress.className = 'progress bg-rebuild-progress';
      const bar = document.createElement('div');
      bar.className = 'progress-bar';
      progress.appendChild(bar);
      rebuildBgStatus.insertAdjacentElement('afterend', progress);
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
      if (rebuildBgStatus && pct > 95 && !rebuildBgStatus.textContent.includes('✅') && !rebuildBgStatus.textContent.includes('❌')) {
        rebuildBgStatus.textContent = 'Finalizing...';
      }
    }, 120);
    try {
      const res = await fetch('/api/rebuild-background', { method: 'POST' });
      const j = await res.json();
      if (res.ok && j.status === 'success') {
        if (bar) bar.style.width = '100%';
        progress.classList.add('ok');
        rebuildBgStatus.textContent = '✅ Background rebuilt';
        // Clear Identify panel so stale prompts/messages are removed
        resetIdentifyUI();
      } else {
        if (bar) bar.style.width = '100%';
        progress.classList.add('err');
        rebuildBgStatus.textContent = `❌ Failed: ${j.error || res.statusText}`;
      }
    } catch (e) {
      if (bar) bar.style.width = '100%';
      progress.classList.add('err');
      rebuildBgStatus.textContent = '❌ Network error';
    } finally {
      clearInterval(tick);
      const spent = Date.now() - startedAt;
      const minShow = 1200;
      setTimeout(() => {
        rebuildBgStatus.textContent = '';
        progress?.remove();
        rebuildBgBtn.disabled = false;
      }, Math.max(800, minShow - spent));
    }
  });
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

function setupVisualizer(stream, canvas) {
  const audioCtx = new AudioContext();
  const analyser = audioCtx.createAnalyser();
  const source = audioCtx.createMediaStreamSource(stream);
  source.connect(analyser);

  const canvasCtx = canvas.getContext("2d");
  analyser.fftSize = 2048;
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  let animationId;
  function draw() {
    animationId = requestAnimationFrame(draw);
    analyser.getByteTimeDomainData(dataArray);
    canvasCtx.fillStyle = "#111";
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = "lime";
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

  return () => {
    cancelAnimationFrame(animationId);
    audioCtx.close();
  };
}
