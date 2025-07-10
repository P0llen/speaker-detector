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

  if (!btn || !resultEl) return;

  btn.onclick = async () => {
    const prompt = getSpeakerPrompt();
    resultEl.innerHTML = `
      <p class="mic-instruction">${prompt}</p>
      <p>🎙️ Preparing to record for identification...</p>
    `;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      let stopVisualizer;
      if (canvas) stopVisualizer = setupVisualizer(stream, canvas);

      const countdownEl = document.createElement("div");
      countdownEl.textContent = "Recording will start in 3...";
      resultEl.appendChild(countdownEl);
      await delayCountdown(countdownEl, 3);

      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
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
          const { speaker, score, error } = await res.json();

          resultEl.innerHTML = error
            ? `❌ ${error}`
            : `🗣️ <strong>${speaker}</strong> (score: ${score})<br><audio controls src="${url}"></audio>`;

          if (!error) {
            const feedbackBtn = document.createElement("button");
            feedbackBtn.textContent = "✏️ Correct Speaker";
            feedbackBtn.style.marginLeft = "10px";
            feedbackBtn.onclick = () => showCorrectionUI(blob, resultEl);
            resultEl.appendChild(feedbackBtn);
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

