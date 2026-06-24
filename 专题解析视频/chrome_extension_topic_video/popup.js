const logEl = document.getElementById("log");

function log(value) {
  logEl.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function setBusy(button, busy) {
  button.disabled = busy;
  button.style.opacity = busy ? "0.65" : "";
}

async function run(type, button) {
  setBusy(button, true);
  log("正在处理中，请稍候...");
  try {
    const response = await chrome.runtime.sendMessage({ type });
    log(response);
  } catch (error) {
    log(String(error?.message || error));
  } finally {
    setBusy(button, false);
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "TOPIC_VIDEO_PROGRESS") {
    log(message.message || message);
  }
  return false;
});

document.getElementById("health").addEventListener("click", (event) => run("HEALTH", event.currentTarget));
document.getElementById("dryRun").addEventListener("click", (event) => run("DRY_TOPIC_VIDEO_COPY", event.currentTarget));
document.getElementById("start").addEventListener("click", (event) => run("START_TOPIC_VIDEO_COPY", event.currentTarget));
