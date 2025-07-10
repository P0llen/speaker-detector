let audioContext;
let analyser;
let mediaStream;
let animationId;
let selectedDeviceId = null;
let fallbackDevices = [];
let isRunning = false;

export function setupMicTest() {
  const template = document.getElementById("mic-test-template");
  const root = document.getElementById("mic-test-root");

  if (!template || !root) {
    console.error("❌ Mic Test template or #mic-test-root not found");
    return;
  }

  const clone = template.content.cloneNode(true);
  root.appendChild(clone);


  const canvas = document.getElementById("visualizer-mic-test");
  const micStatus = document.getElementById("mic-test-status");
  const micSelector = document.getElementById("mic-selector");
  const button = document.getElementById("action-btn");

  const savedDeviceId = localStorage.getItem("mic-test-device-id");

  // 🔄 Populate mic dropdown
  navigator.mediaDevices.enumerateDevices().then(devices => {
    const audioInputs = devices.filter(d => d.kind === "audioinput");
    fallbackDevices = audioInputs.map(d => d.deviceId);

    if (audioInputs.length === 0) {
      micStatus.textContent = "❌ No microphones found.";
      return;
    }

    micSelector.innerHTML = "";
    audioInputs.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      const label = device.label || `Microphone ${index + 1}`;
      option.textContent = `🎤 ${label}`;
      micSelector.appendChild(option);

      if (device.deviceId === savedDeviceId) {
        option.selected = true;
        selectedDeviceId = device.deviceId;
      }
    });

    if (!selectedDeviceId) {
      selectedDeviceId = micSelector.value;
    }
  });

  micSelector.addEventListener("change", async () => {
    selectedDeviceId = micSelector.value;
    localStorage.setItem("mic-test-device-id", selectedDeviceId);

    // If test is active, restart with the new mic
    if (isRunning) {
      stopMicTest();
      await startMicTest();
    }
  });

  button.addEventListener("click", async () => {
    if (isRunning) {
      stopMicTest();
      micStatus.textContent = "🛑 Mic test stopped.";
      button.textContent = "▶️ Start Mic Test";
      isRunning = false;
      return;
    }

    const success = await startMicTest();

    if (!success && fallbackDevices.length > 1) {
      const nextDevice = fallbackDevices.find(id => id !== selectedDeviceId);
      if (nextDevice) {
        selectedDeviceId = nextDevice;
        micSelector.value = nextDevice;
        localStorage.setItem("mic-test-device-id", nextDevice);
        await startMicTest();
      }
    }

    if (!success) {
      micStatus.textContent = "❌ Failed to access microphone.";
      button.textContent = "▶️ Start Mic Test";
      isRunning = false;
    }
  });

  async function startMicTest() {
    try {
      micStatus.textContent = "🎙️ Mic test started...";
      button.textContent = "⏹️ Stop Mic Test";
      isRunning = true;

      const constraints = selectedDeviceId
        ? { audio: { deviceId: { exact: selectedDeviceId } } }
        : { audio: true };

      mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(mediaStream);

      analyser = audioContext.createAnalyser();
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
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
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          x += sliceWidth;
        }

        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.stroke();
      }

      draw();
      return true;
    } catch (err) {
      console.warn(`❌ Failed to start mic with deviceId=${selectedDeviceId}:`, err);
      return false;
    }
  }

  function stopMicTest() {
    if (animationId) cancelAnimationFrame(animationId);
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      mediaStream = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
  }
}
