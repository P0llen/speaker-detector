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
  const intervalSlider = mount.querySelector('#interval-slider');
  const windowSlider = mount.querySelector('#window-slider');
  const unknownSlider = mount.querySelector('#unknown-slider');
  const holdSlider = mount.querySelector('#hold-slider');
  // Advanced sliders
  const spkThreshSlider = mount.querySelector('#spk-thresh-slider');
  const bgThreshSlider = mount.querySelector('#bg-thresh-slider');
  const marginSlider = mount.querySelector('#margin-slider');
  const bgOverSlider = mount.querySelector('#bg-over-slider');
  const rmsSlider = mount.querySelector('#rms-slider');
  const confSmoothSlider = mount.querySelector('#conf-smooth-slider');
  const sessionLogToggle = mount.querySelector('#session-log-toggle');
  const embedAvgToggle = mount.querySelector('#embed-avg-toggle');
  const embedAvgNSlider = mount.querySelector('#embed-avg-n-slider');
  const embedAvgNVal = mount.querySelector('#embed-avg-n-value');
  const vadTrimToggle = mount.querySelector('#vad-trim-toggle');
  const intervalVal = mount.querySelector('#interval-value');
  const windowVal = mount.querySelector('#window-value');
  const unknownVal = mount.querySelector('#unknown-value');
  const holdVal = mount.querySelector('#hold-value');
  const spkThreshVal = mount.querySelector('#spk-thresh-value');
  const bgThreshVal = mount.querySelector('#bg-thresh-value');
  const marginVal = mount.querySelector('#margin-value');
  const bgOverVal = mount.querySelector('#bg-over-value');
  const rmsVal = mount.querySelector('#rms-value');
  const confSmoothVal = mount.querySelector('#conf-smooth-value');
  // Defaults display
  const defSpk = mount.querySelector('#def-spk-thresh');
  const defBg = mount.querySelector('#def-bg-thresh');
  const defMargin = mount.querySelector('#def-margin');
  const defBgOver = mount.querySelector('#def-bg-over');
  const defRms = mount.querySelector('#def-rms');
  const defConfSmooth = mount.querySelector('#def-conf-smooth');
  // Background rebuild controls
  const rebuildBgBtn = mount.querySelector('#rebuild-background-btn');
  const rebuildBgStatus = mount.querySelector('#rebuild-background-status');
  const logsContainer = mount.querySelector('#session-logs');
  const clearLogsBtn = mount.querySelector('#clear-logs-btn');
  const diagDetails = mount.querySelector('#live-diagnostics');
  const diagContent = mount.querySelector('#live-diag-content');
  let diagOpen = false;
  const reasonLegendBtn = mount.querySelector('#reason-legend-btn');
  const liveHintsEl = mount.querySelector('#live-hints');
  const recentReasons = [];
  // Profiles UI
  const profilesSelect = mount.querySelector('#profiles-select');
  const profileApplyBtn = mount.querySelector('#profile-apply-btn');
  const profileSaveBtn = mount.querySelector('#profile-save-btn');
  const profileRenameBtn = mount.querySelector('#profile-rename-btn');
  const profileDeleteBtn = mount.querySelector('#profile-delete-btn');
  const profilePreviewBtn = mount.querySelector('#profile-preview-btn');

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
                    try { alert(`Saved clip to ${speaker}. Consider rebuilding their model.`); } catch {}
                    resetIdentifyUI();
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
                    try { alert('Background sample added. Please rebuild the background model.'); } catch {}
                    resetIdentifyUI();
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
                  try { alert(`Saved clip to ${target}. Consider rebuilding.`); } catch {}
                  resetIdentifyUI();
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
                  try { alert('Background sample added. Please rebuild the background model.'); } catch {}
                  resetIdentifyUI();
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
  let currentSessionId = null;
  let uiLogs = [];
  let restoreConsoleCapture = null;

  const logLine = (msg) => {
    const ts = isoLocal(new Date());
    uiLogs.push(`${ts} ${msg}`);
  };

  function isoLocal(d) {
    const pad = (n, l = 2) => String(n).padStart(l, '0');
    return (
      d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + 'T' +
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.' + pad(d.getMilliseconds(), 3)
    );
  }

  const showLogPopup = (title, text) => {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed'; overlay.style.inset = '0'; overlay.style.background = 'rgba(0,0,0,0.5)';
    overlay.style.zIndex = '9999'; overlay.style.display = 'flex'; overlay.style.alignItems = 'center'; overlay.style.justifyContent = 'center';
    const box = document.createElement('div');
    box.style.background = '#fff'; box.style.color = '#222'; box.style.width = 'min(800px, 90vw)'; box.style.height = 'min(70vh, 600px)';
    box.style.borderRadius = '8px'; box.style.padding = '12px'; box.style.display = 'flex'; box.style.flexDirection = 'column';
    const hdr = document.createElement('div'); hdr.textContent = title; hdr.style.fontWeight = '600'; hdr.style.marginBottom = '8px';
    // Try to render grouped, typed log view; otherwise fall back to raw text
    const content = renderGroupedLog(text) || (() => { const pre = document.createElement('pre'); pre.textContent = text; pre.style.flex = '1'; pre.style.overflow = 'auto'; return pre; })();
    const actions = document.createElement('div'); actions.style.marginTop = '8px';
    const copyBtn = document.createElement('button'); copyBtn.textContent = 'Copy All';
    copyBtn.onclick = async () => { try { await navigator.clipboard.writeText(text); copyBtn.textContent = 'Copied'; setTimeout(()=>copyBtn.textContent='Copy All',1200);} catch {} };
    const closeBtn = document.createElement('button'); closeBtn.textContent = 'Close'; closeBtn.style.marginLeft = '8px'; closeBtn.onclick = () => overlay.remove();
    actions.appendChild(copyBtn); actions.appendChild(closeBtn);
    box.appendChild(hdr); box.appendChild(content); box.appendChild(actions);
    overlay.appendChild(box); document.body.appendChild(overlay);
  };

  function renderGroupedLog(text) {
    if (!text || typeof text !== 'string') return null;
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    // Parse ISO timestamps with optional fractional seconds and 'Z'
    const reLine = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z)?)\s*(.*)$/;
    const reAnyTs = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z)?)/;
    const groups = new Map();
    for (const ln of lines) {
      let tsStr = null, rest = '';
      let m = ln.match(reLine);
      if (m) { tsStr = m[1]; rest = m[2] || ''; }
      else {
        const m2 = ln.match(reAnyTs);
        if (m2) { tsStr = m2[1]; rest = ln.replace(m2[1], '').trim(); }
      }
      if (!tsStr) tsStr = '—';
      let tsMs = Date.parse(tsStr);
      if (Number.isNaN(tsMs)) {
        // Try coercing to UTC
        tsMs = Date.parse(tsStr + 'Z');
      }
      const tsKey = isFinite(tsMs) ? isoLocal(new Date(tsMs)).slice(0,19) : tsStr.slice(0,19); // group by local second
      const isBackend = ln.includes('/api/active-speaker payload=');
      const kind = isBackend ? 'backend' : 'frontend';
      const msg = rest || ln;
      const arr = groups.get(tsKey) || [];
      arr.push({ kind, msg, raw: ln, tsMs: isFinite(tsMs) ? tsMs : 0 });
      groups.set(tsKey, arr);
    }
    if (groups.size === 0) return null;

    const wrapper = document.createElement('div');
    wrapper.style.flex = '1';
    wrapper.style.overflow = 'auto';
    wrapper.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    wrapper.style.fontSize = '12px';

    const keys = Array.from(groups.keys()).sort();
    for (const ts of keys) {
      const block = document.createElement('div');
      block.style.borderBottom = '1px solid #eee';
      block.style.padding = '6px 0';
      const header = document.createElement('div');
      // Render header in local time for clarity
      const arr = groups.get(ts) || [];
      const baseMs = arr.length ? arr.slice().sort((a,b)=>a.tsMs-b.tsMs)[0].tsMs : null;
      header.textContent = baseMs ? isoLocal(new Date(baseMs)).slice(0,19) : ts;
      header.style.color = '#555';
      header.style.fontWeight = '600';
      header.style.marginBottom = '4px';
      block.appendChild(header);
      const entries = (groups.get(ts) || []).slice().sort((a, b) => a.tsMs - b.tsMs);
      for (const entry of entries) {
        const line = document.createElement('div');
        const tag = document.createElement('span');
        tag.textContent = entry.kind === 'backend' ? 'backend' : 'frontend';
        tag.style.display = 'inline-block';
        tag.style.minWidth = '68px';
        tag.style.marginRight = '8px';
        tag.style.fontWeight = entry.kind === 'backend' ? '700' : '600';
        tag.style.color = entry.kind === 'backend' ? '#0a4' : '#06c';
        const textSpan = document.createElement('span');
        textSpan.textContent = entry.msg || entry.raw;
        line.appendChild(tag);
        line.appendChild(textSpan);
        block.appendChild(line);
      }
      wrapper.appendChild(block);
    }
    return wrapper;
  }

  function enableConsoleCapture(onEmit) {
    const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error };
    const wrap = (level) => (...args) => { try { onEmit(level, args); } catch {} try { orig[level](...args); } catch {} };
    console.log = wrap('log');
    console.info = wrap('info');
    console.warn = wrap('warn');
    console.error = wrap('error');
    return () => { console.log = orig.log; console.info = orig.info; console.warn = orig.warn; console.error = orig.error; };
  }

  const pushSessionEntry = (sid) => {
    if (!logsContainer) return;
    const combined = `${sid}.log`;
    const row = document.createElement('div'); row.style.marginTop = '6px';
    row.innerHTML = `
      <code>${sid}</code>
      <button data-view class="btn-ghost" style="margin-left:8px;">View</button>
      <button data-del class="btn-warn" title="Delete" style="margin-left:8px;">🗑️</button>
    `;
    logsContainer.prepend(row);

    const onView = async () => {
      // Prefer combined file; fallback to merging legacy ui_ and api_ files
      try {
        let text = '';
        let res = await fetch(`/api/logs/file/${encodeURIComponent(combined)}`);
        if (res.ok) {
          text = await res.text();
        } else {
          const parts = [];
          try { const r1 = await fetch(`/api/logs/file/${encodeURIComponent('ui_' + sid + '.log')}`); if (r1.ok) parts.push(await r1.text()); } catch {}
          try { const r2 = await fetch(`/api/logs/file/${encodeURIComponent('api_' + sid + '.log')}`); if (r2.ok) parts.push(await r2.text()); } catch {}
          if (!parts.length) throw new Error('No log found for session');
          text = parts.join('\n');
        }
        showLogPopup(combined, text);
      } catch (e) {
        alert('Failed to load log: ' + e.message);
      }
    };

    const onDelete = async () => {
      if (!confirm(`Delete ${combined}?`)) return;
      try {
        // Always attempt to remove combined and legacy files to prevent reappearance on refresh
        await Promise.allSettled([
          fetch(`/api/logs/file/${encodeURIComponent(combined)}`, { method: 'DELETE' }),
          fetch(`/api/logs/file/${encodeURIComponent('ui_' + sid + '.log')}`, { method: 'DELETE' }),
          fetch(`/api/logs/file/${encodeURIComponent('api_' + sid + '.log')}`, { method: 'DELETE' }),
        ]);
        // If we are currently logging to this session, stop logging immediately
        if (currentSessionId && currentSessionId === sid) {
          currentSessionId = null;
          uiLogs = [];
        }
        row.remove();
      } catch (e) {
        alert('Failed to delete log: ' + e.message);
      }
    };

    row.querySelector('[data-view]')?.addEventListener('click', onView);
    row.querySelector('[data-del]')?.addEventListener('click', onDelete);
  };

  const fetchSettings = async () => {
    const res = await fetch('/api/listening-mode');
    currentSettings = await res.json();
    // Initialize sliders and readouts
    const i = currentSettings.interval_ms ?? 3000;
    const w = currentSettings.window_s ?? 1.25;
    const u = currentSettings.unknown_streak_limit ?? 2;
    const h = currentSettings.hold_ttl_s ?? 4.0;
    const spk = currentSettings.spk_threshold ?? currentSettings.defaults?.spk_threshold ?? 0.4;
    const bg = currentSettings.bg_threshold ?? currentSettings.defaults?.bg_threshold ?? 0.55;
    const m = currentSettings.decision_margin ?? currentSettings.defaults?.decision_margin ?? 0.07;
    const bgo = currentSettings.bg_margin_over_spk ?? currentSettings.defaults?.bg_margin_over_spk ?? 0.04;
    const rms = currentSettings.rms_speech_gate ?? currentSettings.defaults?.rms_speech_gate ?? 0.001;
    const confSmooth = currentSettings.confidence_smoothing ?? currentSettings.defaults?.confidence_smoothing ?? 0.30;
    const bgAsSpk = !!(currentSettings.background_as_speaker ?? currentSettings.defaults?.background_as_speaker ?? false);
    intervalSlider.value = i;
    windowSlider.value = w;
    unknownSlider.value = u;
    holdSlider.value = h;
    spkThreshSlider.value = spk;
    bgThreshSlider.value = bg;
    marginSlider.value = m;
    bgOverSlider.value = bgo;
    rmsSlider.value = rms;
    if (confSmoothSlider) confSmoothSlider.value = confSmooth;
    if (sessionLogToggle) sessionLogToggle.checked = !!(currentSettings.session_logging ?? currentSettings.defaults?.session_logging ?? false);
    if (embedAvgToggle) embedAvgToggle.checked = !!(currentSettings.embed_avg ?? currentSettings.defaults?.embed_avg ?? false);
    if (embedAvgNSlider) embedAvgNSlider.value = (currentSettings.embed_avg_n ?? currentSettings.defaults?.embed_avg_n ?? 3);
    if (embedAvgNVal) embedAvgNVal.textContent = String(embedAvgNSlider?.value || '3');
    if (vadTrimToggle) vadTrimToggle.checked = !!(currentSettings.vad_trim ?? currentSettings.defaults?.vad_trim ?? false);
    intervalVal.textContent = `${i}`;
    windowVal.textContent = Number(w).toFixed(2);
    unknownVal.textContent = `${u}`;
    holdVal.textContent = Number(h).toFixed(1);
    spkThreshVal.textContent = Number(spk).toFixed(2);
    bgThreshVal.textContent = Number(bg).toFixed(2);
    marginVal.textContent = Number(m).toFixed(3);
    bgOverVal.textContent = Number(bgo).toFixed(3);
    rmsVal.textContent = Number(rms).toFixed(4);
    if (confSmoothVal) confSmoothVal.textContent = Number(confSmooth).toFixed(2);
    // Fill default numbers in help text
    if (defSpk) defSpk.textContent = Number(currentSettings.defaults?.spk_threshold ?? 0.4).toFixed(2);
    if (defBg) defBg.textContent = Number(currentSettings.defaults?.bg_threshold ?? 0.55).toFixed(2);
    if (defMargin) defMargin.textContent = Number(currentSettings.defaults?.decision_margin ?? 0.07).toFixed(3);
    if (defBgOver) defBgOver.textContent = Number(currentSettings.defaults?.bg_margin_over_spk ?? 0.04).toFixed(3);
    if (defRms) defRms.textContent = Number(currentSettings.defaults?.rms_speech_gate ?? 0.001).toFixed(4);
    if (defConfSmooth) defConfSmooth.textContent = Number(currentSettings.defaults?.confidence_smoothing ?? 0.30).toFixed(2);
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
      interval_ms: parseInt(intervalSlider.value, 10),
      window_s: parseFloat(windowSlider.value),
      unknown_streak_limit: parseInt(unknownSlider.value, 10),
      hold_ttl_s: parseFloat(holdSlider.value),
      // Advanced
      spk_threshold: parseFloat(spkThreshSlider.value),
      bg_threshold: parseFloat(bgThreshSlider.value),
      decision_margin: parseFloat(marginSlider.value),
      bg_margin_over_spk: parseFloat(bgOverSlider.value),
      rms_speech_gate: parseFloat(rmsSlider.value),
      confidence_smoothing: parseFloat(confSmoothSlider?.value || 0.30),
      session_logging: !!(sessionLogToggle && sessionLogToggle.checked),
      embed_avg: !!(embedAvgToggle && embedAvgToggle.checked),
      embed_avg_n: parseInt(embedAvgNSlider?.value || '3', 10),
      vad_trim: !!(vadTrimToggle && vadTrimToggle.checked),
      ...overrides,
    };
    // Update labels immediately
    intervalVal.textContent = `${payload.interval_ms}`;
    windowVal.textContent = Number(payload.window_s).toFixed(2);
    unknownVal.textContent = `${payload.unknown_streak_limit}`;
    holdVal.textContent = Number(payload.hold_ttl_s).toFixed(1);
    spkThreshVal.textContent = Number(payload.spk_threshold).toFixed(2);
    bgThreshVal.textContent = Number(payload.bg_threshold).toFixed(2);
    marginVal.textContent = Number(payload.decision_margin).toFixed(3);
    bgOverVal.textContent = Number(payload.bg_margin_over_spk).toFixed(3);
    rmsVal.textContent = Number(payload.rms_speech_gate).toFixed(4);
    if (embedAvgNVal && embedAvgNSlider) embedAvgNVal.textContent = String(embedAvgNSlider.value);
    debouncedPost(payload);
  };

  // Slider change handlers
  [intervalSlider, windowSlider, unknownSlider, holdSlider,
   spkThreshSlider, bgThreshSlider, marginSlider, bgOverSlider, rmsSlider, confSmoothSlider, embedAvgToggle, embedAvgNSlider, vadTrimToggle].forEach((el) => {
    el?.addEventListener('input', () => applySettingsFromSliders());
  });
  sessionLogToggle?.addEventListener('change', () => applySettingsFromSliders());

  const startPolling = () => {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      try {
        const sid = currentSessionId ? `?sid=${encodeURIComponent(currentSessionId)}` : '';
        const t0 = performance.now();
        const res = await fetch('/api/active-speaker' + sid);
        const data = await res.json();
        const t1 = performance.now();
        liveSpeakerEl.textContent = data.speaker ?? '—';
        liveConfEl.textContent = (data.confidence ?? 0).toFixed(2);
        liveIsSpeakingEl.textContent = data.is_speaking ? 'yes' : 'no';
        liveBackendStatusEl.textContent = data.status ?? '—';
        const sugg = data.suggested && data.suggested.speaker ? `${data.suggested.speaker} (${Number(data.suggested.confidence||0).toFixed(2)})` : '—';
        if (liveSuggestedEl) liveSuggestedEl.textContent = sugg;
        const t2 = performance.now();
        if (currentSessionId) {
          const d = data.diag || {};
          logLine(`API:active-speaker sent=${t0.toFixed(1)}ms recv=${t1.toFixed(1)}ms ui=${t2.toFixed(1)}ms speaker=${data.speaker} conf=${Number(data.confidence||0).toFixed(2)} status=${data.status} top1=${d.top1_name||'—'}:${Number(d.top1_score||0).toFixed(2)} top2=${Number(d.top2_score||0).toFixed(2)} bg=${d.bg_score!=null?Number(d.bg_score).toFixed(2):'—'} margin=${Number(d.margin||0).toFixed(3)} reason=${d.reason||'—'}`);
        }
        // Live Output: Scores + Run config
        const d = data.diag || {};
        // Determine reason class + label
        const reasonCode = String(d.reason || 'unknown');
        const reasonMap = {
          'spk:margin': { cls: 'reason-spk-margin', label: 'spk:margin' },
          'spk:thr':    { cls: 'reason-spk-thr',    label: 'spk:thr'    },
          'bg:override':{ cls: 'reason-bg-override',label: 'bg:override'},
          'unknown':    { cls: 'reason-unknown',    label: 'unknown'    },
          'spk:weak':   { cls: 'reason-spk-weak',   label: 'spk:weak'   },
          'bg:weak':    { cls: 'reason-bg-weak',    label: 'bg:weak'    },
        };
        const r = reasonMap[reasonCode] || reasonMap['unknown'];
        const scoresText = `top1 ${d.top1_name||'—'}:${Number(d.top1_score||0).toFixed(2)}, next ${Number(d.top2_score||0).toFixed(2)}, bg ${d.bg_score!=null?Number(d.bg_score).toFixed(2):'—'}, margin ${Number(d.margin||0).toFixed(3)} (<span class="reason-tag ${r.cls}">${r.label}</span>)`;
        const runText = `window ${Number(d.window_s||0).toFixed(2)}s, interval ${d.interval_ms||'—'}ms, α ${Number(d.conf_smooth||0).toFixed(2)}`;
        const liveScoresEl = mount.querySelector('#live-scores');
        const liveConfigEl = mount.querySelector('#live-config');
        if (liveScoresEl) liveScoresEl.innerHTML = scoresText;
        if (liveConfigEl) liveConfigEl.textContent = runText;

        // Track recent reasons (last 40 ticks) and show guidance if many borderline
        recentReasons.push(reasonCode);
        if (recentReasons.length > 40) recentReasons.shift();
        if (liveHintsEl && recentReasons.length >= 10) {
          const counts = recentReasons.reduce((a,c)=>{a[c]=(a[c]||0)+1;return a;},{});
          const total = recentReasons.length;
          const p = (k)=> (counts[k]||0)/total;
          let hint = '';
          if (p('unknown') > 0.45 || p('spk:weak') > 0.45) {
            hint = 'Tip: Many unknown/weak decisions. Add more speaker samples (guided enroll), enable Rolling Avg and VAD Trim, or increase Window to 3–5s.';
          } else if (p('bg:override') > 0.40) {
            hint = 'Tip: Frequent background overrides. Record background noise samples and Rebuild Background, or raise the RMS speech gate slightly.';
          } else if (p('bg:weak') > 0.40) {
            hint = 'Tip: Background is weak while speech present. Consider lowering background threshold or improving background model.';
          } else if (p('spk:thr') > 0.50) {
            hint = 'Tip: Accepting by threshold often. Slightly raise Speaker threshold or decision margin for stricter matches.';
          } else if (p('spk:margin') > 0.60) {
            hint = 'Great separation detected frequently.';
          }
          liveHintsEl.textContent = hint;
        }
        // Render diagnostics only when drawer open
        if (diagOpen && diagContent) {
          const d = data.diag || {};
          diagContent.innerHTML = `
            <div>Window: <strong>${Number(d.window_s ?? 0).toFixed(2)}s</strong>, Interval: <strong>${d.interval_ms ?? '—'}ms</strong></div>
            <div>VAD Trim: <strong>${d.vad_trim ? 'on' : 'off'}</strong>${d.trimmed_ratio != null ? `, Kept: <strong>${Math.round((Number(d.trimmed_ratio)||0)*100)}%</strong>` : ''}</div>
            <div>Embed Avg: <strong>${d.embed_avg ? 'on' : 'off'}</strong>${d.embed_buf_len != null ? ` (N=${d.embed_avg_n}, buf=${d.embed_buf_len})` : ''}</div>
            <div>Conf Smoothing α: <strong>${Number(d.conf_smooth ?? 0).toFixed(2)}</strong></div>
            <div>RMS: <strong>${Number(d.rms ?? 0).toFixed(4)}</strong>, Speech present: <strong>${d.speech_present ? 'yes' : 'no'}</strong></div>
            <div>Loop elapsed: <strong>${Math.round(Number(d.elapsed_ms||0))}ms</strong></div>
          `;
        }
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
    // Start new session if logging enabled
    currentSessionId = null; uiLogs = [];
    const loggingEnabled = !!(currentSettings?.session_logging || (sessionLogToggle && sessionLogToggle.checked));
    if (loggingEnabled) {
      // Use local time for session id so filenames reflect local clock
      currentSessionId = isoLocal(new Date()).replace(/[:.]/g, '-');
      logLine(`SESSION START ${currentSessionId}`);
      // Capture frontend console logs during the session
      restoreConsoleCapture = enableConsoleCapture((level, args) => {
        try { const msg = args.map(String).join(' '); logLine(`console.${level}: ${msg}`); } catch {}
      });
      // Immediately create log file with settings header at the top
      try {
        await fetch('/api/logs/session', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: currentSessionId, text: `SESSION START ${currentSessionId}` })
        });
      } catch {}
    }
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
    // Stop capturing console
    try { restoreConsoleCapture?.(); } catch {}
    restoreConsoleCapture = null;

    // Flush session logs if any
    if (currentSessionId && uiLogs.length) {
      logLine(`SESSION END ${currentSessionId}`);
      try {
        await fetch('/api/logs/session', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: currentSessionId, lines: uiLogs })
        });
        pushSessionEntry(currentSessionId);
      } catch (e) { console.warn('Failed to save session log', e); }
    }
    currentSessionId = null; uiLogs = [];
  };

  liveToggleBtn?.addEventListener('click', () => {
    if (liveToggleBtn.textContent.includes('Start')) startLive();
    else stopLive();
  });

  // Initialize from backend on mount
  fetchSettings();
  // Load profiles on mount
  loadProfiles();
  // Diagnostics drawer toggle
  diagDetails?.addEventListener('toggle', () => { diagOpen = !!diagDetails.open; });
  // Reason legend popup
  reasonLegendBtn?.addEventListener('click', () => showReasonLegend());
  // Profiles handlers
  profileApplyBtn?.addEventListener('click', onApplyProfile);
  profileSaveBtn?.addEventListener('click', onSaveProfile);
  profileRenameBtn?.addEventListener('click', onRenameProfile);
  profileDeleteBtn?.addEventListener('click', onDeleteProfile);
  profilePreviewBtn?.addEventListener('click', onPreviewProfile);

  async function loadProfiles() {
    try {
      const res = await fetch('/api/listening-profiles');
      const j = await res.json();
      if (!profilesSelect) return;
      profilesSelect.innerHTML = '';
      const names = Array.isArray(j.profiles) ? j.profiles : [];
      for (const n of names) {
        const opt = document.createElement('option');
        opt.value = n; opt.textContent = n;
        profilesSelect.appendChild(opt);
      }
    } catch {}
  }

  async function onApplyProfile() {
    const name = profilesSelect?.value;
    if (!name) return;
    try {
      const res = await fetch(`/api/listening-profiles/${encodeURIComponent(name)}`);
      const j = await res.json();
      const s = j.settings || {};
      await fetch('/api/listening-mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) });
      await fetchSettings();
    } catch (e) { alert('Failed to apply profile'); }
  }

  async function onSaveProfile() {
    const name = prompt('Enter profile name:');
    if (!name) return;
    const s = {
      interval_ms: parseInt(intervalSlider.value, 10),
      window_s: parseFloat(windowSlider.value),
      unknown_streak_limit: parseInt(unknownSlider.value, 10),
      hold_ttl_s: parseFloat(holdSlider.value),
      spk_threshold: parseFloat(spkThreshSlider.value),
      bg_threshold: parseFloat(bgThreshSlider.value),
      decision_margin: parseFloat(marginSlider.value),
      bg_margin_over_spk: parseFloat(bgOverSlider.value),
      rms_speech_gate: parseFloat(rmsSlider.value),
      confidence_smoothing: parseFloat(confSmoothSlider?.value || 0.30),
      session_logging: !!(sessionLogToggle && sessionLogToggle.checked),
      embed_avg: !!(embedAvgToggle && embedAvgToggle.checked),
      embed_avg_n: parseInt(embedAvgNSlider?.value || '3', 10),
      vad_trim: !!(vadTrimToggle && vadTrimToggle.checked),
      mode: 'single',
    };
    try {
      await fetch('/api/listening-profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, settings: s }) });
      await loadProfiles();
      if (profilesSelect) profilesSelect.value = name;
    } catch (e) { alert('Failed to save profile'); }
  }

  async function onRenameProfile() {
    const old = profilesSelect?.value;
    if (!old) return;
    const newer = prompt('New name for profile:', old);
    if (!newer || newer === old) return;
    try {
      const res = await fetch(`/api/listening-profiles/${encodeURIComponent(old)}/rename`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ new_name: newer }) });
      const j = await res.json();
      if (!res.ok) { alert(j.error || 'Rename failed'); return; }
      await loadProfiles();
      if (profilesSelect) profilesSelect.value = newer;
    } catch (e) { alert('Failed to rename profile'); }
  }

  async function onDeleteProfile() {
    const name = profilesSelect?.value;
    if (!name) return;
    if (!confirm(`Delete profile "${name}"?`)) return;
    try {
      await fetch(`/api/listening-profiles/${encodeURIComponent(name)}`, { method: 'DELETE' });
      await loadProfiles();
    } catch (e) { alert('Failed to delete profile'); }
  }

  async function onPreviewProfile() {
    const name = profilesSelect?.value;
    if (!name) return;
    try {
      const res = await fetch(`/api/listening-profiles/${encodeURIComponent(name)}`);
      const j = await res.json();
      const s = j.settings || {};
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify(s, null, 2);
      showInlinePopup(`Profile: ${name}`, pre.outerHTML);
    } catch (e) { alert('Failed to preview profile'); }
  }

  function showReasonLegend() {
    const html = `
      <div style="font-weight:600;margin-bottom:6px;">Decision reason legend</div>
      <div><span class="reason-tag reason-spk-margin">spk:margin</span> &nbsp;Accepted speaker because top1−top2 ≥ margin (strong separation).</div>
      <div><span class="reason-tag reason-spk-thr">spk:thr</span> &nbsp;Accepted speaker because top1 ≥ speaker threshold.</div>
      <div><span class="reason-tag reason-bg-override">bg:override</span> &nbsp;Background dominated required margin/threshold.</div>
      <div><span class="reason-tag reason-unknown">unknown</span> &nbsp;Insufficient evidence.</div>
      <div><span class="reason-tag reason-spk-weak">spk:weak</span> &nbsp;Top speaker didn’t meet margin or threshold.</div>
      <div><span class="reason-tag reason-bg-weak">bg:weak</span> &nbsp;Background didn’t clearly win while speech likely present.</div>
      <hr style="margin:8px 0;"/>
      <div style="font-weight:600;margin-bottom:6px;">Improvement tips</div>
      <ul style="margin:0 0 6px 18px;">
        <li>Unknown/weak often: add guided enrollment clips; enable Rolling Avg + VAD Trim; increase Window to 3–5s.</li>
        <li>Background overrides: record ambient noise samples and Rebuild Background; consider raising RMS speech gate slightly.</li>
        <li>Threshold‑based accepts common: slightly raise Speaker threshold or Decision margin.</li>
      </ul>
    `;
    showInlinePopup('Live reason legend', html);
  }

  function showInlinePopup(title, html) {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed'; overlay.style.inset = '0'; overlay.style.background = 'rgba(0,0,0,0.5)';
    overlay.style.zIndex = '9999'; overlay.style.display = 'flex'; overlay.style.alignItems = 'center'; overlay.style.justifyContent = 'center';
    const box = document.createElement('div');
    box.style.background = '#fff'; box.style.color = '#222'; box.style.width = 'min(720px, 90vw)'; box.style.maxHeight = '70vh';
    box.style.borderRadius = '8px'; box.style.padding = '12px'; box.style.overflow = 'auto';
    const hdr = document.createElement('div'); hdr.textContent = title; hdr.style.fontWeight = '600'; hdr.style.marginBottom = '8px';
    const content = document.createElement('div'); content.innerHTML = html;
    const actions = document.createElement('div'); actions.style.marginTop = '8px';
    const closeBtn = document.createElement('button'); closeBtn.textContent = 'Close'; closeBtn.onclick = () => overlay.remove();
    actions.appendChild(closeBtn);
    box.appendChild(hdr); box.appendChild(content); box.appendChild(actions);
    overlay.appendChild(box); document.body.appendChild(overlay);
  }
  // Load existing logs list on mount
  (async function loadLogs() {
    try {
      if (!logsContainer) return;
      const items = await fetch('/api/logs').then(r=>r.json());
      const sids = new Map();
      for (const it of Array.isArray(items) ? items : []) {
        const name = String(it.file || '');
        let m = name.match(/^(.+)\.log$/);
        if (m) {
          const sid = m[1];
          // Skip legacy prefixed files when a combined file exists
          if (sid.startsWith('ui_') || sid.startsWith('api_')) {
            const base = sid.replace(/^(?:ui_|api_)/, '');
            if (!sids.has(base)) sids.set(base, false);
          } else {
            sids.set(sid, true); // combined
          }
        }
      }
      logsContainer.innerHTML = '';
      Array.from(sids.keys()).sort().reverse().forEach(sid => pushSessionEntry(sid));
    } catch (e) { /* ignore */ }
  })();

  // Clear all logs handler
  clearLogsBtn?.addEventListener('click', async () => {
    if (!confirm('Delete all session logs?')) return;
    try {
      const items = await fetch('/api/logs').then(r=>r.json());
      const files = Array.isArray(items) ? items.map(it => String(it.file || '')).filter(Boolean) : [];
      await Promise.allSettled(files.map(name => fetch(`/api/logs/file/${encodeURIComponent(name)}`, { method: 'DELETE' })));
      if (logsContainer) logsContainer.innerHTML = '<em>No logs.</em>';
      // Also stop logging if an active session exists, to prevent immediate re-creation
      if (currentSessionId) {
        currentSessionId = null;
        uiLogs = [];
      }
    } catch (e) {
      alert('Failed to clear logs.');
    }
  });

  // Reset to defaults handler
  resetDefaultsBtn?.addEventListener('click', () => {
    const d = (currentSettings && currentSettings.defaults) || null;
    if (!d) return;
    intervalSlider.value = d.interval_ms;
    windowSlider.value = d.window_s;
    unknownSlider.value = d.unknown_streak_limit;
    holdSlider.value = d.hold_ttl_s;
    spkThreshSlider.value = d.spk_threshold ?? 0.4;
    bgThreshSlider.value = d.bg_threshold ?? 0.55;
    marginSlider.value = d.decision_margin ?? 0.07;
    bgOverSlider.value = d.bg_margin_over_spk ?? 0.04;
    rmsSlider.value = d.rms_speech_gate ?? 0.001;
    if (confSmoothSlider) confSmoothSlider.value = d.confidence_smoothing ?? 0.30;
    if (embedAvgToggle) embedAvgToggle.checked = !!(d.embed_avg ?? false);
    if (embedAvgNSlider) embedAvgNSlider.value = d.embed_avg_n ?? 3;
    if (embedAvgNVal) embedAvgNVal.textContent = String(embedAvgNSlider?.value || '3');
    if (vadTrimToggle) vadTrimToggle.checked = !!(d.vad_trim ?? false);
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
