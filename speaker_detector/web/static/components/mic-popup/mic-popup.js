let stream = null;
let audioCtx = null;
let animationId = null;

export function setupMicPopup() {
  const template = document.getElementById("mic-popup-template");
  const root = document.getElementById("mic-popup-root");

  if (!template || !root) {
    console.error("❌ Mic popup template or root not found");
    return;
  }

  const clone = template.content.cloneNode(true);
  root.appendChild(clone);
}

export function showMicPopup(instruction = "Please speak clearly...") {
  const popup = document.querySelector(".mic-popup");
  const text = popup?.querySelector(".mic-instruction");
  const status = popup?.querySelector("#mic-status");

  if (!popup || !text || !status) return;

  text.textContent = instruction;
  status.textContent = "Idle";
  popup.classList.add("active");
}

export function hideMicPopup() {
  const popup = document.querySelector(".mic-popup");
  if (popup) popup.classList.remove("active");
}
