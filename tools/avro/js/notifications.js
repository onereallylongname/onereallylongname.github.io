const toastQueue = [];
let toastActive = false;
const warDuration = 4000;
const infoDuration = 2000;
const successuration = 1500;

// Enqueue a the next toast (use this one )
function warningToast(message) {
  showToast("⚠️ " + message, warDuration);
}

// Enqueue a the next toast (use this one )
function infoToast(message) {
  showToast("ℹ️ " + message, infoDuration);
}

// Enqueue a the next toast (use this one )
function successToast(message) {
  showToast("✅ " + message, successuration);
}

function showToast(message, duration = 3000) {
  toastQueue.push({ message, duration });
  if (!toastActive) showNextToast();
}

function showNextToast() {
  if (toastQueue.length === 0) {
    toastActive = false;
    return;
  }

  toastActive = true;
  const { message, duration } = toastQueue.shift();
  popToast(message, duration);

  setTimeout(showNextToast, duration + 220);
}

function popToast(msg, duration) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, duration);
}
