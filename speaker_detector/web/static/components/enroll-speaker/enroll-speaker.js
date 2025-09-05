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
  const status = mount.querySelector("#enroll-speaker-status");
  const guidedBtn = mount.querySelector('#guided-enroll-btn');
  const wizardNameInput = document.getElementById('wizard-speaker-id');
  const wizard = document.getElementById('enroll-wizard');
  const closeWizardBtn = document.getElementById('close-enroll-wizard');
  const wizardProgress = document.getElementById('wizard-progress');
  const wizardPrompt = document.getElementById('wizard-prompt');
  const wizardStatus = document.getElementById('wizard-status');
  const wizardAudio = document.getElementById('wizard-audio');
  const wizardRecord = document.getElementById('wizard-record');
  const wizardRerecord = document.getElementById('wizard-rerecord');
  const wizardAccept = document.getElementById('wizard-accept');
  const wizardCancel = document.getElementById('wizard-cancel');

  // Load enrollment defaults from backend
  let ENROLL_CLIP_DURATION_S = 7;
  let ENROLL_TARGET_CLIPS = 8;
  let WIZ_STEP_COUNT = 7;
  fetch('/api/enroll-defaults')
    .then(r => r.json())
    .then(j => {
      if (typeof j.clip_duration_s === 'number') ENROLL_CLIP_DURATION_S = j.clip_duration_s;
      if (typeof j.target_clips === 'number') ENROLL_TARGET_CLIPS = j.target_clips;
      WIZ_STEP_COUNT = Math.max(1, Number.isFinite(ENROLL_TARGET_CLIPS) ? ENROLL_TARGET_CLIPS : 7);
    })
    .catch(() => {
      // ignore UI defaults
    });

  async function refreshProgressFor(name) {
    if (!name) { return; }
    try {
      const list = await fetch('/api/speakers').then(r=>r.json());
      const item = Array.isArray(list) ? list.find(x => (x && x.name) === name) : null;
      const count = item?.recordings || 0;
      if (wizardStatus) wizardStatus.dataset.serverCount = String(count);
    } catch (e) {
      console.warn('Failed to load speakers for progress', e);
    }
  }

  // Quick Enroll removed; guided flow only

  // ---- Guided Enrollment Wizard ----
  const promptTexts = [
    'Please say: "Hi, my name is [name]."',
    'Please say: "I enjoy talking about technology and science."',
    'Please count from one to ten clearly.',
    'Please read: "The quick brown fox jumps over the lazy dog."',
    "Please say today's date and the current time.",
    'Please describe your favorite hobby in one or two sentences.',
    'Please say: "This is a sample for speaker enrollment."'
  ];

  function renderWizardProgress(doneCount) {
    if (!wizardProgress) return;
    wizardProgress.innerHTML = '';
    for (let i = 0; i < WIZ_STEP_COUNT; i++) {
      const bar = document.createElement('div');
      bar.className = 'bar' + (i < doneCount ? ' filled' : '');
      wizardProgress.appendChild(bar);
    }
  }

  let wizIndex = 0;
  let wizStream = null;
  let wizChunks = [];
  let wizRecorder = null;
  function getPrompt(i) {
    const id = (wizardNameInput?.value || '').trim();
    const base = promptTexts[i] || 'Please speak naturally.';
    return id ? base.replace('[name]', id) : base;
  }

  async function startWizRecording(durationSec) {
    wizardAudio.innerHTML = '';
    wizardAccept.disabled = true;
    wizardRerecord.disabled = true;

    wizardStatus.textContent = '⏳ Recording starts in 3...';
    await delayCountdown(wizardStatus, 3);
    wizardStatus.textContent = `⏺️ Recording ${durationSec}s...`;

    // Prefer mic from Mic Test
    const preferredId = localStorage.getItem('mic-test-device-id');
    const constraints = preferredId && preferredId !== 'default' && preferredId !== 'communications'
      ? { audio: { deviceId: { exact: preferredId } } }
      : { audio: true };
    try {
      wizStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      try { wizStream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (err) {
        wizardStatus.textContent = '❌ Microphone access denied.'; return;
      }
    }

    const prefs = [ 'audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/ogg','audio/mp4' ];
    const best = (window.MediaRecorder?.isTypeSupported) ? prefs.find(t => MediaRecorder.isTypeSupported(t)) : null;
    wizRecorder = best ? new MediaRecorder(wizStream, { mimeType: best }) : new MediaRecorder(wizStream);
    wizChunks = [];
    wizRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) wizChunks.push(e.data); };
    wizRecorder.onstop = async () => {
      try { wizStream.getTracks().forEach(t => t.stop()); } catch {}
      const blob = new Blob(wizChunks);
      const url = URL.createObjectURL(blob);
      wizardAudio.innerHTML = '';
      const audio = document.createElement('audio'); audio.controls = true; audio.src = url; audio.style.display = 'block';
      wizardAudio.appendChild(audio);
      wizardStatus.textContent = '▶️ Review your recording. Accept or re-record.';
      wizardAccept.disabled = false;
      wizardRerecord.disabled = false;
      wizardAccept.onclick = async () => {
        wizardAccept.disabled = true; wizardRerecord.disabled = true;
        wizardStatus.textContent = '⏳ Uploading clip...';
        try {
          const id = (wizardNameInput?.value || '').trim();
          if (!id) { wizardStatus.textContent = '❌ Please enter a speaker name first.'; return; }
          const form = new FormData();
          form.append('file', blob, `sample_${Date.now()}.webm`);
          const res = await fetch(`/api/enroll/${encodeURIComponent(id)}`, { method: 'POST', body: form });
          if (res.ok) {
            renderWizardProgress(wizIndex + 1);
            refreshProgressFor(id);
            wizIndex += 1;
            if (wizIndex >= WIZ_STEP_COUNT) {
              wizardStatus.textContent = `✅ All ${WIZ_STEP_COUNT} recordings saved. Closing...`;
              setTimeout(() => { wizard.classList.add('hidden'); wizardStatus.textContent=''; wizardAudio.innerHTML=''; }, 900);
              setupSpeakersList(speakersRoot);
            } else {
              wizardPrompt.textContent = getPrompt(wizIndex);
              wizardStatus.textContent = 'Ready for the next recording.';
              wizardAccept.disabled = true; wizardRerecord.disabled = true;
            }
          } else {
            wizardStatus.textContent = '❌ Upload failed.';
            wizardAccept.disabled = false; wizardRerecord.disabled = false;
          }
        } catch (e) {
          wizardStatus.textContent = '❌ Upload failed.';
          wizardAccept.disabled = false; wizardRerecord.disabled = false;
        }
      };
      wizardRerecord.onclick = async () => {
        try { URL.revokeObjectURL(url); } catch {}
        startWizRecording(ENROLL_CLIP_DURATION_S);
      };
    };

    wizRecorder.start();
    setTimeout(() => { try { wizRecorder.stop(); } catch {} }, Math.max(1000, Math.floor(durationSec * 1000)));
  }

  function openWizard() {
    if (wizardNameInput) wizardNameInput.focus();
    wizIndex = 0; renderWizardProgress(0);
    wizardPrompt.textContent = getPrompt(0);
    wizardStatus.textContent = 'Enter a speaker name, then press Record to begin.';
    wizardAudio.innerHTML = '';
    wizardRecord.disabled = false; wizardRerecord.disabled = true; wizardAccept.disabled = true;
    wizard.classList.remove('hidden');
  }

  guidedBtn?.addEventListener('click', openWizard);
  closeWizardBtn?.addEventListener('click', () => wizard.classList.add('hidden'));
  wizardCancel?.addEventListener('click', () => wizard.classList.add('hidden'));
  wizardRecord?.addEventListener('click', () => {
    const id = (wizardNameInput?.value || '').trim();
    if (!id) {
      if (wizardStatus) wizardStatus.textContent = '❌ Please enter a speaker name before recording.';
      wizardNameInput?.focus();
      return;
    }
    startWizRecording(ENROLL_CLIP_DURATION_S);
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


// Auto-run
// setupEnrollSpeaker();
