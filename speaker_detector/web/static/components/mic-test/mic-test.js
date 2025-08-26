// Mic Test — state-driven UI so the button text/icon/classes always sync.

let audioContext, analyser, mediaStream, animationId;
let isRunning = false;

let selectedDeviceId = null;
let lastMicIds = [];
let lastUserChoiceMeta = null;

let mediaRecorder = null;
let recordedChunks = [];
let recordedBlob = null;
let recordedUrl = null;
let playbackAudio = null;

// authoritative state
let recState = "idle"; // "idle" | "recording" | "ready" | "playing"

let overlayEl = null, modalEl = null, booted = false;

/* ---------------- Utilities ---------------- */
function ensureCss() {
  const href = "/static/components/mic-test/mic-test.css";
  if (!document.querySelector(`link[href="${href}"]`)) {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = href;
    document.head.appendChild(l);
  }
}
function ensureToastContainer() {
  if (!document.getElementById("toast-container")) {
    const c = document.createElement("div");
    c.id = "toast-container";
    document.body.appendChild(c);
  }
}
function toast(msg) {
  ensureToastContainer();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.getElementById("toast-container").appendChild(el);
  el.offsetHeight; el.classList.add("show");
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 200); }, 1600);
}

/* ---------------- Popup shell ---------------- */
function buildOverlayOnce() {
  if (overlayEl) return;
  overlayEl = document.createElement("div");
  overlayEl.className = "mic-overlay";
  overlayEl.id = "mic-test-overlay";

  modalEl = document.createElement("div");
  modalEl.className = "mic-modal";
  modalEl.innerHTML = `<div id="mic-test-popup-mount"></div>`;

  overlayEl.appendChild(modalEl);
  document.body.appendChild(overlayEl);

  overlayEl.addEventListener("click", (e) => { if (e.target === overlayEl) closePopup(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && overlayEl.classList.contains("show")) closePopup(); });
}
async function getMicTemplate() {
  let tpl = document.getElementById("mic-test-template");
  if (tpl) return tpl;
  try {
    const html = await fetch("/static/components/mic-test/mic-test.html", { cache: "no-store" }).then(r=>r.text());
    const tmp = document.createElement("div"); tmp.innerHTML = html;
    const fetched = tmp.querySelector("#mic-test-template");
    if (fetched) {
      const clone = fetched.cloneNode(true);
      clone.id = "mic-test-template";
      clone.style.display = "none";
      document.body.appendChild(clone);
      return clone;
    }
  } catch {}
  return null;
}
async function openPopup() {
  ensureCss(); buildOverlayOnce();
  const tpl = await getMicTemplate();
  if (!tpl) { console.error("❌ mic-test-template not found"); return; }
  const mount = modalEl.querySelector("#mic-test-popup-mount");
  mount.innerHTML = ""; mount.appendChild(tpl.content.cloneNode(true));
  await initMicDom(mount);
  mount.querySelector("#mic-close-btn")?.addEventListener("click", closePopup);
  overlayEl.classList.add("show");
}
function closePopup() {
  overlayEl?.classList.remove("show");
  teardownMicTest();
  stopRecording({ discard: false });
  stopPlayback();
}

/* ---------------- Sticky launcher ---------------- */
function renderStickyBtnOnce() {
  if (document.getElementById("mic-sticky-btn")) return;
  const btn = document.createElement("button");
  btn.id = "mic-sticky-btn";
  btn.className = "mic-sticky-btn";
  btn.textContent = "🎤 Mic Test";
  btn.addEventListener("click", openPopup);
  document.body.appendChild(btn);
}

/* ---------------- Selection helpers ---------------- */
const isConcreteId = (id) => !!id && id !== "default" && id !== "communications";
const norm = (s) =>
  (s || "").normalize("NFKD")
    .replace(/\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu, "")
    .replace(/[\u2000-\u206F\u2E00-\u2E7F]/g, "")
    .replace(/\s+/g, " ").trim().toLowerCase();

async function enumerateConcreteInputs() {
  const devs = await navigator.mediaDevices.enumerateDevices();
  return devs.filter(d => d.kind === "audioinput" && isConcreteId(d.deviceId))
             .map(d => ({ deviceId: d.deviceId, groupId: d.groupId||"", label: d.label||"", normLabel: norm(d.label||"") }));
}
async function resolveActualDeviceId(stream, requestedId, micSelector) {
  const meta = await enumerateConcreteInputs();
  const ids = meta.map(m=>m.deviceId);

  const track = stream?.getAudioTracks?.()[0] || null;
  const settingsId = track?.getSettings?.().deviceId || "";
  const trackLabel = track?.label || "";
  const trackNorm  = norm(trackLabel);

  if (isConcreteId(settingsId) && ids.includes(settingsId)) return settingsId;
  if (trackLabel) { const exact = meta.find(m=>m.label===trackLabel); if (exact) return exact.deviceId; }
  if (trackNorm)  { const byNorm = meta.find(m=>m.normLabel===trackNorm); if (byNorm) return byNorm.deviceId; }
  if (isConcreteId(requestedId) && ids.includes(requestedId)) return requestedId;

  if (lastUserChoiceMeta) {
    const byGroup = meta.find(m=>m.groupId && m.groupId===lastUserChoiceMeta.groupId);
    if (byGroup) return byGroup.deviceId;
    const byLabel = meta.find(m=>m.label===lastUserChoiceMeta.label);
    if (byLabel) return byLabel.deviceId;
    const byNorm2= meta.find(m=>m.normLabel===lastUserChoiceMeta.normLabel);
    if (byNorm2) return byNorm2.deviceId;
    if (typeof lastUserChoiceMeta.optionIndex==="number" && micSelector?.options?.length) {
      const idAtIndex = micSelector.options[lastUserChoiceMeta.optionIndex].value;
      if (ids.includes(idAtIndex)) return idAtIndex;
    }
  }
  return (meta[0]||{}).deviceId || null;
}

/* ---------------- Visualizer ---------------- */
function startVisualizer(canvas) {
  if (!canvas || !analyser) return;
  const ctx = canvas.getContext("2d");
  analyser.fftSize = 2048;
  const bufferLength = analyser.fftSize;
  const dataArray = new Uint8Array(bufferLength);
  function draw() {
    animationId = requestAnimationFrame(draw);
    analyser.getByteTimeDomainData(dataArray);
    ctx.fillStyle = "#222"; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.lineWidth = 2; ctx.strokeStyle = "#0f0"; ctx.beginPath();
    const sliceWidth = canvas.width / bufferLength; let x = 0;
    for (let i=0;i<bufferLength;i++) {
      const v = dataArray[i] / 128.0; const y = (v * canvas.height)/2;
      i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y); x += sliceWidth;
    }
    ctx.lineTo(canvas.width, canvas.height/2); ctx.stroke();
  }
  draw(); isRunning = true;
}
function stopVisualizer() {
  if (animationId) cancelAnimationFrame(animationId);
  animationId = null; isRunning = false;
}

/* ---------------- Stream lifecycle ---------------- */
async function openStreamForDevice(deviceId, canvas, micStatus) {
  const constraints = isConcreteId(deviceId) ? { audio: { deviceId: { exact: deviceId } } } : { audio: true };
  teardownMicTest();
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    const micSelector = canvas.closest("#mic-test").querySelector("#mic-selector");
    const actualId = await resolveActualDeviceId(mediaStream, deviceId, micSelector);
    await buildDropdown(micSelector, actualId, micStatus);
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(mediaStream);
    analyser = audioContext.createAnalyser(); source.connect(analyser);
    startVisualizer(canvas);
    micStatus && (micStatus.textContent = "🎙️ Mic active…");
    return true;
  } catch (err) {
    console.warn("getUserMedia failed:", err);
    micStatus && (micStatus.textContent = "❌ Failed to access microphone.");
    teardownMicTest();
    return false;
  }
}
function teardownMicTest() {
  stopVisualizer();
  try { if (mediaStream) mediaStream.getTracks().forEach(t=>t.stop()); if (audioContext) audioContext.close(); } catch {}
  mediaStream = null; audioContext = null; analyser = null;
}

/* ---------------- Dropdown ---------------- */
async function buildDropdown(micSelector, preferDeviceId, statusEl) {
  const meta = await enumerateConcreteInputs();
  const ids = meta.map(m=>m.deviceId);

  micSelector.innerHTML = "";
  meta.forEach((m, i) => {
    const opt = document.createElement("option");
    opt.value = m.deviceId; opt.textContent = `🎤 ${m.label || `Microphone ${i+1}`}`;
    micSelector.appendChild(opt);
  });

  let toSelect = preferDeviceId || selectedDeviceId || localStorage.getItem("mic-test-device-id");
  if (!toSelect || !ids.includes(toSelect)) toSelect = ids[0] || null;

  if (toSelect && ids.includes(toSelect)) {
    micSelector.value = toSelect;
    selectedDeviceId = toSelect;
    localStorage.setItem("mic-test-device-id", toSelect);
  }

  statusEl && (statusEl.textContent = ids.length ? "✅ Mic list refreshed." : "❌ No microphones found.");
  lastMicIds = ids;
}

/* ---------------- Button UI (single source of truth) ---------------- */
function setActionUI(btn, state) {
  // map state -> label + class
  const map = {
    idle:   { text: "🔴 Record", cls: "btn-record" },
    recording: { text: "⏹️ Stop", cls: "btn-stop" },
    ready:  { text: "▶️ Play",  cls: "btn-play" },
    playing:{ text: "⏹️ Stop", cls: "btn-stop" },
  };
  const m = map[state] || map.idle;
  btn.classList.remove("btn-record","btn-stop","btn-play");
  btn.classList.add("btn", m.cls);
  btn.textContent = m.text;
}
function setRecState(state, btn) {
  recState = state;
  if (btn) setActionUI(btn, recState);
}

/* ---------------- Recording helpers ---------------- */
function bestMime() {
  const prefs = ["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus","audio/ogg","audio/mp4"];
  for (const t of prefs) if (window.MediaRecorder?.isTypeSupported?.(t)) return t;
  return "";
}
function stopPlayback() {
  try { if (playbackAudio) { playbackAudio.pause(); playbackAudio.currentTime = 0; } } catch {}
  playbackAudio = null;
  // do not change recordedUrl here; keep state to ready if we have a clip
}
function hardResetRecording(btn) {
  try { if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop(); } catch {}
  mediaRecorder = null; recordedChunks = []; recordedBlob = null;
  if (recordedUrl) { URL.revokeObjectURL(recordedUrl); recordedUrl = null; }
  stopPlayback();
  setRecState("idle", btn);
}
async function startRecording(btn) {
  if (!mediaStream) return false;
  const type = bestMime();
  try {
    recordedChunks = []; recordedBlob = null;
    if (recordedUrl) { URL.revokeObjectURL(recordedUrl); recordedUrl = null; }

    mediaRecorder = new MediaRecorder(mediaStream, type ? { mimeType: type } : undefined);
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      recordedBlob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      recordedUrl  = URL.createObjectURL(recordedBlob);
      teardownMicTest();                  // stop live monitor
      setRecState("ready", btn);          // ⟵ ensure UI sync happens here
    };
    mediaRecorder.start();
    setRecState("recording", btn);        // ⟵ and here
    return true;
  } catch (e) {
    console.warn("Failed to start recording:", e);
    return false;
  }
}
function stopRecording({ discard = false } = {}) {
  try {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    } else if (discard) {
      hardResetRecording(); // btn handled by caller if needed
    }
  } catch {}
}
function startPlayback(btn, canvas, micStatus) {
  if (!recordedUrl) return;
  const wasRunning = isRunning;
  if (wasRunning) stopVisualizer();

  stopPlayback();
  playbackAudio = new Audio(recordedUrl);
  setRecState("playing", btn);

  playbackAudio.onended = async () => {
    setRecState("ready", btn);
    if (wasRunning) {
      await openStreamForDevice(selectedDeviceId || localStorage.getItem("mic-test-device-id"), canvas, micStatus);
    }
  };
  playbackAudio.play().catch(() => {
    setRecState("ready", btn);
    if (wasRunning) openStreamForDevice(selectedDeviceId, canvas, micStatus);
  });
}

/* ---------------- Main DOM wiring ---------------- */
async function initMicDom(scope) {
  const canvas = scope.querySelector("#visualizer-mic-test");
  const micStatus = scope.querySelector("#mic-test-status");
  const micSelector = scope.querySelector("#mic-selector");
  const refreshBtn = scope.querySelector("#refresh-mics");
  const actionBtn = scope.querySelector("#action-btn");
  const restartBtn = scope.querySelector("#restart-btn");

  if (!canvas || !micStatus || !micSelector || !actionBtn) {
    console.error("❌ Mic Test template missing required elements."); return;
  }

  // Initial UI (always set by JS)
  setRecState(recordedBlob ? "ready" : "idle", actionBtn);
  micStatus.textContent = "Pending";

  await buildDropdown(micSelector, null, micStatus);

  // Hot-plug: auto-select new mic, reset to Record, possibly reopen stream
  navigator.mediaDevices.addEventListener("devicechange", async () => {
    const before = new Set(lastMicIds);
    const meta = await enumerateConcreteInputs();
    const ids = meta.map(m=>m.deviceId);
    const newlyAdded = ids.filter(id => !before.has(id));
    const autoPick = newlyAdded[0] || selectedDeviceId;

    await buildDropdown(micSelector, autoPick, micStatus);

    hardResetRecording(actionBtn); // ⟵ reset UI to Record

    if (newlyAdded[0]) {
      selectedDeviceId = newlyAdded[0];
      localStorage.setItem("mic-test-device-id", selectedDeviceId);
      const label = meta.find(m=>m.deviceId===selectedDeviceId)?.label || "New device";
      toast(`🎧 New microphone detected: ${label} (selected)`);
    } else {
      toast("🔌 Audio device change detected");
    }

    if (isRunning) await openStreamForDevice(selectedDeviceId, canvas, micStatus);
  });

  // Manual refresh
  refreshBtn?.addEventListener("click", async () => {
    micStatus.textContent = "🔁 Refreshing mic list…";
    await buildDropdown(micSelector, selectedDeviceId, micStatus);
  });

  // Selection change → reset to Record + open new device
  micSelector.addEventListener("change", async () => {
    const optionIndex = micSelector.selectedIndex;
    const opt = micSelector.options[optionIndex];
    const chosenId = opt?.value || null;
    const chosenLabel = (opt?.textContent || "").replace(/^🎤\s*/, "");

    const meta = await enumerateConcreteInputs();
    const chosenMeta =
      meta.find(m=>m.deviceId===chosenId) ||
      meta.find(m=>m.label===chosenLabel) ||
      meta.find(m=>m.normLabel===norm(chosenLabel)) || null;

    lastUserChoiceMeta = {
      deviceId: chosenMeta?.deviceId || chosenId || "",
      groupId: chosenMeta?.groupId || "",
      label:   chosenMeta?.label || chosenLabel || "",
      normLabel: chosenMeta ? chosenMeta.normLabel : norm(chosenLabel),
      optionIndex,
    };

    selectedDeviceId = chosenId;
    localStorage.setItem("mic-test-device-id", chosenId || "");

    hardResetRecording(actionBtn); // ⟵ reset UI to Record

    const ok = await openStreamForDevice(chosenId, canvas, micStatus);
    if (ok) {
      const finalOpt = micSelector.options[micSelector.selectedIndex];
      const finalLabel = finalOpt ? finalOpt.textContent.replace(/^🎤\s*/, "") : "Selected device";
      toast(`✅ Microphone switched to: ${finalLabel}`);
    }
  });

  // Restart link → force Record state
  restartBtn?.addEventListener("click", () => {
    hardResetRecording(actionBtn);
    toast("↻ Reset to Record");
  });

  // Single control
  actionBtn.addEventListener("click", async () => {
    if (recState === "idle") {
      if (!mediaStream) {
        const ok = await openStreamForDevice(selectedDeviceId || localStorage.getItem("mic-test-device-id"), canvas, micStatus);
        if (!ok) return;
      }
      const ok = await startRecording(actionBtn);
      if (!ok) toast("⚠️ Recording not supported in this browser.");
      return;
    }
    if (recState === "recording") {
      stopRecording(); // onstop → setRecState("ready", actionBtn)
      setActionUI(actionBtn, "recording"); // immediate feedback; final state handled in onstop
      return;
    }
    if (recState === "ready") {
      startPlayback(actionBtn, canvas, micStatus);
      return;
    }
    if (recState === "playing") {
      stopPlayback();
      setRecState("ready", actionBtn);
      return;
    }
  });
}

/* ---------------- Public API ---------------- */
export async function setupMicTest() {
  if (booted) return true;
  booted = true;
  ensureCss();
  renderStickyBtnOnce();
  return true;
}
