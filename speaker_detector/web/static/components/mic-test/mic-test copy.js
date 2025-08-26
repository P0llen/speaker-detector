// Popup Mic Test with cross‑browser stable selection.
// Key change: we ONLY list concrete devices (no "default"/"communications"),
// and we always set the dropdown to the actual track device after getUserMedia.

let audioContext;
let analyser;
let mediaStream;
let animationId;
let isRunning = false;

let selectedDeviceId = null;
let lastMicIds = [];
let lastUserChoiceMeta = null; // { deviceId, groupId, label, normLabel, optionIndex }

let overlayEl = null;
let modalEl = null;
let booted = false;

/* ---------- Utilities ---------- */
function ensureCss() {
  const href = "/static/components/mic-test/mic-test.css";
  if (!document.querySelector(`link[href="${href}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
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
  el.offsetHeight;
  el.classList.add("show");
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 200);
  }, 1600);
}
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

  overlayEl.addEventListener("click", (e) => {
    if (e.target === overlayEl) closePopup();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlayEl.classList.contains("show")) closePopup();
  });
}
async function getMicTemplate() {
  let tpl = document.getElementById("mic-test-template");
  if (tpl) return tpl;
  try {
    const url = "/static/components/mic-test/mic-test.html";
    const html = await fetch(url, { cache: "no-store" }).then((r) => r.text());
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    const fetchedTpl = tmp.querySelector("#mic-test-template");
    if (fetchedTpl) {
      const clone = fetchedTpl.cloneNode(true);
      clone.id = "mic-test-template";
      clone.style.display = "none";
      document.body.appendChild(clone);
      return clone;
    }
  } catch {}
  return null;
}

/* ---------- Device helpers ---------- */
const isConcreteId = (id) => !!id && id !== "default" && id !== "communications";
const norm = (s) =>
  (s || "")
    .normalize("NFKD")
    .replace(/\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu, "")
    .replace(/[\u2000-\u206F\u2E00-\u2E7F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

// Return ONLY concrete audio inputs
async function enumerateConcreteInputs() {
  const devs = await navigator.mediaDevices.enumerateDevices();
  const inputs = devs.filter((d) => d.kind === "audioinput" && isConcreteId(d.deviceId));
  return inputs.map((d) => ({
    deviceId: d.deviceId,
    groupId: d.groupId || "",
    label: d.label || "",
    normLabel: norm(d.label || ""),
  }));
}

async function resolveActualDeviceId(stream, requestedId, micSelector) {
  const meta = await enumerateConcreteInputs();
  const ids = meta.map((m) => m.deviceId);

  const track = stream?.getAudioTracks?.()[0] || null;
  const settingsId = track?.getSettings?.().deviceId || "";
  const trackLabel = track?.label || "";
  const trackNorm = norm(trackLabel);

  // 1) settingsId (if concrete)
  if (isConcreteId(settingsId) && ids.includes(settingsId)) return settingsId;

  // 2) exact label
  if (trackLabel) {
    const exact = meta.find((m) => m.label === trackLabel);
    if (exact) return exact.deviceId;
  }

  // 3) normalized label
  if (trackNorm) {
    const byNorm = meta.find((m) => m.normLabel === trackNorm);
    if (byNorm) return byNorm.deviceId;
  }

  // 4) requested concrete id
  if (isConcreteId(requestedId) && ids.includes(requestedId)) return requestedId;

  // 5) last user choice (groupId / label / normLabel / index from current UI)
  if (lastUserChoiceMeta) {
    if (lastUserChoiceMeta.groupId) {
      const g = meta.find((m) => m.groupId === lastUserChoiceMeta.groupId);
      if (g) return g.deviceId;
    }
    if (lastUserChoiceMeta.label) {
      const e = meta.find((m) => m.label === lastUserChoiceMeta.label);
      if (e) return e.deviceId;
    }
    if (lastUserChoiceMeta.normLabel) {
      const n = meta.find((m) => m.normLabel === lastUserChoiceMeta.normLabel);
      if (n) return n.deviceId;
    }
    if (
      typeof lastUserChoiceMeta.optionIndex === "number" &&
      micSelector?.options?.length &&
      lastUserChoiceMeta.optionIndex >= 0 &&
      lastUserChoiceMeta.optionIndex < micSelector.options.length
    ) {
      const idxId = micSelector.options[lastUserChoiceMeta.optionIndex].value;
      if (ids.includes(idxId)) return idxId;
    }
  }

  // 6) fallback: first concrete device
  return (meta[0] || {}).deviceId || null;
}

/* ---------- Popup open/close ---------- */
async function openPopup() {
  ensureCss();
  buildOverlayOnce();

  const tpl = await getMicTemplate();
  if (!tpl) {
    console.error("❌ mic-test-template not found and fetch fallback failed");
    return;
  }

  const mount = modalEl.querySelector("#mic-test-popup-mount");
  mount.innerHTML = "";
  mount.appendChild(tpl.content.cloneNode(true));

  await initMicDom(mount);

  const closeBtn = mount.querySelector("#mic-close-btn");
  if (closeBtn) closeBtn.addEventListener("click", closePopup);

  overlayEl.classList.add("show");
}
function closePopup() {
  overlayEl?.classList.remove("show");
  teardownMicTest();
}

/* ---------- Sticky trigger ---------- */
function renderStickyBtnOnce() {
  if (document.getElementById("mic-sticky-btn")) return;
  const btn = document.createElement("button");
  btn.id = "mic-sticky-btn";
  btn.className = "mic-sticky-btn";
  btn.textContent = "🎤 Mic Test";
  btn.addEventListener("click", openPopup);
  document.body.appendChild(btn);
}

/* ---------- Core mic DOM logic ---------- */
function teardownMicTest() {
  try {
    if (animationId) cancelAnimationFrame(animationId);
    if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
    if (audioContext) audioContext.close();
  } catch {}
  audioContext = null;
  mediaStream = null;
  analyser = null;
  animationId = null;
  isRunning = false;
}

async function initMicDom(scope) {
  const canvas = scope.querySelector("#visualizer-mic-test");
  const micStatus = scope.querySelector("#mic-test-status");
  const micSelector = scope.querySelector("#mic-selector");
  const refreshBtn = scope.querySelector("#refresh-mics");
  const actionBtn = scope.querySelector("#action-btn");

  actionBtn.textContent = "▶️ Start Mic Test";
  micStatus.textContent = "Pending";

  const savedDeviceId = localStorage.getItem("mic-test-device-id") || null;

  function closeStream() {
    if (animationId) { cancelAnimationFrame(animationId); animationId = null; }
    if (mediaStream) { mediaStream.getTracks().forEach((t) => t.stop()); mediaStream = null; }
    if (audioContext) { try { audioContext.close(); } catch {} audioContext = null; }
    analyser = null;
  }

  async function buildDropdown(preferDeviceId = null) {
    const meta = await enumerateConcreteInputs();
    const ids = meta.map((m) => m.deviceId);

    // Rebuild options ONLY from concrete devices
    micSelector.innerHTML = "";
    meta.forEach((m, index) => {
      const opt = document.createElement("option");
      opt.value = m.deviceId;
      opt.textContent = `🎤 ${m.label || `Microphone ${index + 1}`}`;
      micSelector.appendChild(opt);
    });
    lastMicIds = ids;

    // Choose selection
    let toSelect = preferDeviceId || selectedDeviceId || savedDeviceId;
    if (!toSelect || !ids.includes(toSelect)) {
      // if no prior valid choice, pick first concrete (if any)
      toSelect = ids[0] || null;
    }

    if (toSelect && ids.includes(toSelect)) {
      micSelector.value = toSelect;
      selectedDeviceId = toSelect;
      localStorage.setItem("mic-test-device-id", toSelect);
    }

    micStatus.textContent = ids.length ? "✅ Mic list refreshed." : "❌ No microphones found.";
  }

  async function openStream(requestedId = null) {
    try {
      const constraints = {
        audio: isConcreteId(requestedId) ? { deviceId: { exact: requestedId } } : true,
      };

      closeStream();
      mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

      // Resolve actual used device across browsers
      const actualId = await resolveActualDeviceId(mediaStream, requestedId, micSelector);

      // Rebuild list (concrete only) and set selection to the actualId explicitly
      await buildDropdown(actualId);

      // Visualizer
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(mediaStream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      const bufferLength = analyser.fftSize;
      const dataArray = new Uint8Array(bufferLength);
      const ctx = canvas.getContext("2d");

      function draw() {
        animationId = requestAnimationFrame(draw);
        analyser.getByteTimeDomainData(dataArray);

        ctx.fillStyle = "#222";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.lineWidth = 2;
        ctx.strokeStyle = "#0f0";
        ctx.beginPath();

        const sliceWidth = canvas.width / bufferLength;
        let x = 0;
        for (let i = 0; i < bufferLength; i++) {
          const v = dataArray[i] / 128.0;
          const y = (v * canvas.height) / 2;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          x += sliceWidth;
        }
        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.stroke();
      }

      draw();
      micStatus.textContent = "🎙️ Mic test running…";
      actionBtn.textContent = "⏹️ Stop Mic Test";
      isRunning = true;
      return true;
    } catch (err) {
      console.warn(`❌ Failed to open stream (requestedId=${requestedId}):`, err);
      micStatus.textContent = "❌ Failed to access microphone.";
      actionBtn.textContent = "▶️ Start Mic Test";
      isRunning = false;
      closeStream();
      return false;
    }
  }

  // Initial build (after permission, labels are reliable; before permission you may see empty labels)
  await buildDropdown();

  // Hot‑plug
  navigator.mediaDevices.addEventListener("devicechange", async () => {
    micStatus.textContent = "🔌 Audio device change detected…";
    // Preserve current selection if still present; otherwise pick first concrete
    await buildDropdown(selectedDeviceId);
    if (isRunning) {
      await openStream(selectedDeviceId);
    }
  });

  // Manual refresh
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      micStatus.textContent = "🔁 Refreshing mic list…";
      await buildDropdown(selectedDeviceId);
    });
  }

  // User selection (remember a rich meta for later matching)
  micSelector.addEventListener("change", async () => {
    const optionIndex = micSelector.selectedIndex;
    const opt = micSelector.options[optionIndex];
    const chosenId = opt?.value || null;
    const chosenLabel = (opt?.textContent || "").replace(/^🎤\s*/, "");

    const meta = await enumerateConcreteInputs();
    const chosenMeta =
      meta.find((m) => m.deviceId === chosenId) ||
      meta.find((m) => m.label === chosenLabel) ||
      meta.find((m) => m.normLabel === norm(chosenLabel)) ||
      null;

    lastUserChoiceMeta = {
      deviceId: chosenMeta?.deviceId || chosenId || "",
      groupId: chosenMeta?.groupId || "",
      label: chosenMeta?.label || chosenLabel || "",
      normLabel: chosenMeta ? chosenMeta.normLabel : norm(chosenLabel),
      optionIndex,
    };

    selectedDeviceId = chosenId;
    localStorage.setItem("mic-test-device-id", chosenId || "");

    const wasRunning = isRunning;
    const ok = await openStream(chosenId);
    if (ok) {
      const finalOpt = micSelector.options[micSelector.selectedIndex];
      const finalLabel = finalOpt ? finalOpt.textContent.replace(/^🎤\s*/, "") : "Selected device";
      toast(`✅ Microphone switched to: ${finalLabel}`);
      if (!wasRunning) {
        actionBtn.textContent = "⏹️ Stop Mic Test";
        isRunning = true;
      }
    }
  });

  // Start/Stop
  actionBtn.addEventListener("click", async () => {
    if (isRunning) {
      teardownMicTest();
      micStatus.textContent = "🛑 Mic test stopped.";
      actionBtn.textContent = "▶️ Start Mic Test";
      return;
    }
    const ok = await openStream(selectedDeviceId || localStorage.getItem("mic-test-device-id"));
    if (!ok) {
      actionBtn.textContent = "▶️ Start Mic Test";
      isRunning = false;
    }
  });
}

/* ---------- Public API (uniform with loader.js) ---------- */
export async function setupMicTest() {
  if (booted) return true;
  booted = true;
  ensureCss();
  renderStickyBtnOnce();
  return true;
}
