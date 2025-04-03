let mediaRecorder,
  audioChunks = [];

function recordAndSend(endpoint, callback) {
  navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.start();
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
    mediaRecorder.onstop = () => {
      const blob = new Blob(audioChunks, { type: "audio/wav" });
      const formData = new FormData();
      formData.append("file", blob, "sample.wav");

      fetch(endpoint, {
        method: "POST",
        body: formData,
      })
        .then((res) => res.json())
        .then(callback)
        .catch(console.error);
    };

    setTimeout(() => mediaRecorder.stop(), 2000); // record for 2s
  });
}

function testMic() {
  recordAndSend("/identify", (data) => {
    document.getElementById("mic-status").innerText = "Mic works!";
  });
}

function recordAndEnroll() {
  const speakerId = document.getElementById("speaker-id").value.trim();
  if (!speakerId) return alert("Enter speaker ID first");
  recordAndSend(`/enroll/${speakerId}`, (data) => {
    alert("Enrolled " + speakerId);
    fetchSpeakers();
  });
}

function recordAndIdentify() {
  recordAndSend("/identify", (data) => {
    document.getElementById("identify-result").innerText =
      "Detected: " + data.speaker + " (score: " + data.score + ")";
  });
}

function fetchSpeakers() {
  fetch("/speakers")
    .then((res) => res.json())
    .then((data) => {
      const list = document.getElementById("speaker-list");
      list.innerHTML = "";
      data.speakers.forEach((speaker) => {
        const li = document.createElement("li");
        li.innerText = speaker;
        list.appendChild(li);
      });
    });
}
