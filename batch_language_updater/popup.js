const logEl = document.getElementById("log");
const searchName = document.getElementById("searchName");
const languageSelect = document.getElementById("languageSelect");
const startBtn = document.getElementById("startBtn");
const healthBtn = document.getElementById("healthBtn");

function log(text) {
  logEl.textContent = typeof text === "string" ? text : JSON.stringify(text, null, 2);
}

function setBusy(button, busy) {
  button.disabled = busy;
  button.style.opacity = busy ? "0.65" : "";
}

/* ─── 检查登录状态 ─── */
healthBtn.addEventListener("click", async () => {
  setBusy(healthBtn, true);
  try {
    // 尝试发一条空消息到 background 检查 session
    const response = await chrome.runtime.sendMessage({ type: "HEALTH_CHECK" });
    log(response?.ok ? "✅ 已检测到 Session-Id，登录状态正常。" : "⚠️ 未检测到 Session-Id。");
  } catch (error) {
    log("❌ 无法连接 background script。请先刷新课件管理页面获取 Session-Id。");
  } finally {
    setBusy(healthBtn, false);
  }
});

/* ─── 开始修改语种 ─── */
startBtn.addEventListener("click", async () => {
  const searchValue = searchName.value.trim();
  if (!searchValue) {
    log("⚠️ 请输入课件编码。");
    searchName.focus();
    return;
  }

  const targetLanguage = languageSelect.value;
  const targetLabel = languageSelect.options[languageSelect.selectedIndex].text;

  setBusy(startBtn, true);
  log(`正在扫描匹配数据：${searchValue}`);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "UPDATE_LANGUAGE",
      searchName: searchValue,
      targetLanguage
    });

    if (!response) {
      log("❌ 无响应。请先刷新课件管理页面获取 Session-Id。");
      return;
    }

    if (response.ok === false) {
      log(`❌ ${response.error || "操作失败"}`);
      return;
    }

    // 显示汇总
    let summary = `🎯 目标语种：${targetLabel}\n`;
    summary += `📊 总计 ${response.total} 条，成功 ${response.success} 条`;
    if (response.fail > 0) summary += `，失败 ${response.fail} 条`;
    summary += "\n\n";

    // 显示明细
    for (const result of (response.results || [])) {
      if (result.ok) {
        summary += `✅ ${result.code}  修改成功\n`;
      } else {
        summary += `❌ ${result.code}  失败：${result.error || "未知错误"}\n`;
      }
    }

    log(summary);
  } catch (error) {
    log(`❌ 连接失败：${error.message || error}`);
  } finally {
    setBusy(startBtn, false);
  }
});

/* ─── 接收进度 ─── */
chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "UPDATE_LANGUAGE_PROGRESS") return false;

  const stage = message.stage || "";
  const msg = message.message || "";

  const emojiMap = {
    scan: "🔍",
    scanned: "📋",
    processing: "⏳",
    progress: "",
    done: "✅"
  };

  const prefix = emojiMap[stage] || "";
  const detail = message.code ? `[${message.code}] ` : "";
  const percent = Number.isFinite(message.percent) ? ` ${message.percent}%` : "";
  if (stage === "processing" || stage === "progress" || msg) {
    log(`${prefix}${detail}${msg}${percent}`);
  }
  return false;
});

/* ─── 回车触发 ─── */
searchName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") startBtn.click();
});
