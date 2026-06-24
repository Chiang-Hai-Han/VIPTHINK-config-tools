const logEl = document.getElementById("log");
const progressTextEl = document.getElementById("progressText");
const progressBadgeEl = document.getElementById("progressBadge");
const progressBarEl = document.getElementById("progressBar");
const progressMetaEl = document.getElementById("progressMeta");

const buttons = Array.from(document.querySelectorAll("button"));

function stringify(value) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function log(text) {
  logEl.textContent = stringify(text);
}

function setBusyState(busy) {
  for (const button of buttons) {
    button.disabled = busy;
  }
}

function setBadge(label, kind = "") {
  progressBadgeEl.textContent = label;
  progressBadgeEl.className = `badge${kind ? ` ${kind}` : ""}`;
}

function setProgress(percent = 0) {
  const safe = Math.max(0, Math.min(100, Number(percent) || 0));
  progressBarEl.style.width = `${safe}%`;
}

function updateProgress(payload = {}) {
  const {
    stage = "",
    percent = 0,
    current = 0,
    total = 0,
    source_code = "",
    target_code = "",
    success_count,
    message = ""
  } = payload;

  setProgress(percent);
  progressTextEl.textContent = message || "正在处理...";

  if (stage === "finished") {
    setBadge("已完成", "success");
    progressMetaEl.textContent =
      total > 0
        ? `本次共 ${total} 条，成功 ${success_count ?? 0} 条。`
        : "本次任务已完成。";
    return;
  }

  if (stage === "task_error") {
    setBadge("执行异常", "error");
  } else if (stage) {
    setBadge("执行中", "running");
  } else {
    setBadge("未执行");
  }

  const parts = [];
  if (total) {
    parts.push(`进度 ${current}/${total}`);
  }
  if (source_code || target_code) {
    parts.push(`${source_code || "-"} -> ${target_code || "-"}`);
  }
  progressMetaEl.textContent = parts.join(" | ") || "等待开始任务。";
}

async function callMessage(type) {
  setBusyState(true);
  updateProgress({
    stage: "prepare",
    percent: 0,
    message: "正在发送任务，请稍等..."
  });
  log("正在处理，请稍等...");
  try {
    const response = await chrome.runtime.sendMessage({ type });
    log(response);
    if (response?.ok) {
      if (type === "DRY_RUN_JIANAN") {
        setBadge("检查完成", "success");
        progressTextEl.textContent = "任务检查完成";
        progressMetaEl.textContent = `共 ${response.count || 0} 条，可处理 ${response.success_count || 0} 条。`;
        setProgress(100);
      } else if (type === "START_JIANAN") {
        setBadge("执行完成", "success");
        progressTextEl.textContent = "任务执行完成";
        progressMetaEl.textContent = `共 ${response.count || 0} 条，成功 ${response.success_count || 0} 条。`;
        setProgress(100);
      }
    } else if (response?.error) {
      setBadge("执行失败", "error");
      progressTextEl.textContent = "任务执行失败";
      progressMetaEl.textContent = response.error;
    }
  } catch (error) {
    const message = String(error?.message || error);
    log(message);
    setBadge("执行失败", "error");
    progressTextEl.textContent = "任务执行失败";
    progressMetaEl.textContent = message;
  } finally {
    setBusyState(false);
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "JIANAN_PROGRESS") return;
  updateProgress(message);
  if (message.stage === "finished" && message.results) {
    log({
      ok: (message.success_count || 0) === (message.total || 0),
      count: message.total || 0,
      success_count: message.success_count || 0,
      results: message.results
    });
    setBusyState(false);
  }
});

document.getElementById("health").addEventListener("click", async () => {
  setBusyState(true);
  try {
    const response = await fetch("http://127.0.0.1:8771/health");
    const payload = await response.json();
    log(payload);
    setBadge("助手正常", "success");
    progressTextEl.textContent = "本地助手已启动";
    progressMetaEl.textContent = `配置表位置已确认，端口 ${payload.port || 8771} 可用。`;
  } catch (error) {
    const message = "本地助手未启动，请先运行 run_jianan_assistant.bat。";
    log(message);
    setBadge("助手离线", "error");
    progressTextEl.textContent = "本地助手未启动";
    progressMetaEl.textContent = String(error?.message || message);
  } finally {
    setBusyState(false);
  }
});

document.getElementById("prepareWorkbook").addEventListener("click", () => {
  callMessage("PREPARE_WORKBOOK");
});

document.getElementById("openConfig").addEventListener("click", () => {
  callMessage("OPEN_CONFIG_HELP");
});

document.getElementById("captureGuide").addEventListener("click", () => {
  callMessage("CAPTURE_GUIDE");
});

document.getElementById("runCapture").addEventListener("click", () => {
  callMessage("RUN_CAPTURE");
});

document.getElementById("dryRun").addEventListener("click", () => {
  callMessage("DRY_RUN_JIANAN");
});

document.getElementById("start").addEventListener("click", () => {
  callMessage("START_JIANAN");
});
