// /static/components/improve-speaker/improve-speaker.js

let improveEls = null;
let IMPROVE_CLIP_DURATION_MS = 7000;

export function setupImproveSpeaker() {
  const template = document.getElementById('improve-speaker-template');
  const mount = document.getElementById('improve-speaker-root');
  if (!template || !mount) return;
  if (mount.dataset.mounted === '1') return; // idempotent

  mount.appendChild(template.content.cloneNode(true));
  mount.dataset.mounted = '1';

  // Load duration from backend defaults (keep improve in sync)
  fetch('/api/enroll-defaults')
    .then(r => r.json())
    .then(j => {
      if (typeof j.clip_duration_s === 'number') {
        IMPROVE_CLIP_DURATION_MS = Math.max(1000, Math.floor(j.clip_duration_s * 1000));
      }
    })
    .catch(() => {});

  improveEls = {
    modal: document.getElementById('improve-modal'),
    close: document.getElementById('improve-close'),
    cancel: document.getElementById('improve-cancel'),
    name: document.getElementById('improve-speaker-name'),
    status: document.getElementById('improve-status'),
    audio: document.getElementById('improve-audio'),
    record: document.getElementById('improve-record'),
    rerecord: document.getElementById('improve-rerecord'),
    accept: document.getElementById('improve-accept'),
    addAnother: document.getElementById('improve-add-another'),
  };

  const hide = () => { improveEls.modal.classList.add('hidden'); window.dispatchEvent(new CustomEvent('improve-modal-closed')); };
  improveEls.close?.addEventListener('click', hide);
  improveEls.cancel?.addEventListener('click', hide);

  improveEls.record?.addEventListener('click', () => startRecording());
  improveEls.addAnother?.addEventListener('click', () => startRecording());
}

export function openImproveModal(name) {
  if (!improveEls) setupImproveSpeaker();
  if (!improveEls) return;
  improveEls.name.value = name || '';
  improveEls.status.textContent = 'Press Record to add a new sample.';
  improveEls.audio.innerHTML = '';
  improveEls.accept.disabled = true;
  improveEls.rerecord.disabled = true;
  improveEls.addAnother.disabled = true;
  improveEls.modal.classList.remove('hidden');
}

let recStream = null;
let recChunks = [];
let recRecorder = null;

async function startRecording() {
  if (!improveEls) return;
  const name = (improveEls.name.value || '').trim();
  if (!name) { improveEls.status.textContent = '❌ Missing speaker name.'; return; }

  improveEls.audio.innerHTML = '';
  improveEls.accept.disabled = true;
  improveEls.rerecord.disabled = true;
  improveEls.status.textContent = '⏳ Recording starts in 3...';
  await delayCountdown(improveEls.status, 3);
  improveEls.status.textContent = '⏺️ Recording...';

  // Prefer mic from Mic Test
  const preferredId = localStorage.getItem('mic-test-device-id');
  const constraints = preferredId && preferredId !== 'default' && preferredId !== 'communications'
    ? { audio: { deviceId: { exact: preferredId } } }
    : { audio: true };
  try {
    recStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    try { recStream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (err) {
      improveEls.status.textContent = '❌ Microphone access denied.'; return;
    }
  }

  const prefs = [ 'audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/ogg','audio/mp4' ];
  const best = (window.MediaRecorder?.isTypeSupported) ? prefs.find(t => MediaRecorder.isTypeSupported(t)) : null;
  recRecorder = best ? new MediaRecorder(recStream, { mimeType: best }) : new MediaRecorder(recStream);
  recChunks = [];
  recRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) recChunks.push(e.data); };
  recRecorder.onstop = async () => {
    try { recStream.getTracks().forEach(t => t.stop()); } catch {}
    const blob = new Blob(recChunks);
    const url = URL.createObjectURL(blob);
    improveEls.audio.innerHTML = '';
    const audio = document.createElement('audio'); audio.controls = true; audio.src = url; audio.style.display = 'block';
    improveEls.audio.appendChild(audio);
    improveEls.status.textContent = '▶️ Review your recording. Accept or re-record.';
    improveEls.accept.disabled = false;
    improveEls.rerecord.disabled = false;
    improveEls.addAnother.disabled = true;

    improveEls.accept.onclick = async () => {
      improveEls.accept.disabled = true; improveEls.rerecord.disabled = true;
      improveEls.status.textContent = '⏳ Uploading clip...';
      try {
        const form = new FormData();
        form.append('file', blob, `sample_${Date.now()}.webm`);
        const res = await fetch(`/api/speakers/${encodeURIComponent(name)}/improve`, { method: 'POST', body: form });
        const ok = res.ok;
        if (ok) {
          improveEls.status.textContent = '✅ Sample saved. Add another or Done.';
          // notify others to refresh
          window.dispatchEvent(new CustomEvent('improve-modal-success', { detail: { name } }));
          improveEls.addAnother.disabled = false;
          improveEls.record.disabled = false;
        } else {
          improveEls.status.textContent = '❌ Upload failed.';
          improveEls.accept.disabled = false; improveEls.rerecord.disabled = false;
        }
      } catch (e) {
        improveEls.status.textContent = '❌ Upload failed.';
        improveEls.accept.disabled = false; improveEls.rerecord.disabled = false;
      }
    };
    improveEls.rerecord.onclick = async () => {
      try { URL.revokeObjectURL(url); } catch {}
      startRecording();
    };
  };

  // use configured duration from backend
  const dur = IMPROVE_CLIP_DURATION_MS;
  recRecorder.start();
  setTimeout(() => { try { recRecorder.stop(); } catch {} }, dur);
}

function delayCountdown(el, seconds) {
  return new Promise(resolve => {
    let count = seconds;
    const interval = setInterval(() => {
      el.textContent = `⏳ Recording starts in ${count--}...`;
      if (count < 0) { clearInterval(interval); resolve(); }
    }, 1000);
  });
}
