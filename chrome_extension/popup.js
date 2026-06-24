const logEl = document.getElementById("log");
const panel = document.getElementById("prelaunchPanel");
const toggle = document.getElementById("prelaunchToggle");
const chevron = toggle.querySelector(".chevron");
const dataCopyPanel = document.getElementById("dataCopyPanel");
const dataCopyToggle = document.getElementById("dataCopyToggle");
const dataCopyChevron = dataCopyToggle.querySelector(".chevron");
const postlaunchPanel = document.getElementById("postlaunchPanel");
const postlaunchToggle = document.getElementById("postlaunchToggle");
const postlaunchChevron = postlaunchToggle.querySelector(".chevron");
const modal = document.getElementById("overwriteModal");
const overwriteMessage = document.getElementById("overwriteMessage");
const overwriteExisting = document.getElementById("overwriteExisting");
const coursewareDataModal = document.getElementById("coursewareDataModal");
const coursewareSearchName = document.getElementById("coursewareSearchName");
const fillTemplateModal = document.getElementById("fillTemplateModal");
const smallTeacherModal = document.getElementById("smallTeacherModal");
const smallTeacherSearchName = document.getElementById("smallTeacherSearchName");
const autoMatchModal = document.getElementById("autoMatchModal");
const autoMatchTitle = document.getElementById("autoMatchTitle");
const autoMatchSearchName = document.getElementById("autoMatchSearchName");
const workbookChoiceModal = document.getElementById("workbookChoiceModal");
const workbookChoice = document.getElementById("workbookChoice");

const fillOptionIds = {
  "语种": "optionLanguage",
  "科目": "optionSubject",
  "课件类型": "optionCourseType",
  "课件难度": "optionDifficulty",
  "课件版本": "optionVersion",
};

let pendingOverwriteResponse = null;
let pendingAutoMatch = null;
let pendingWorkbookChoice = null;

function log(text) {
  logEl.textContent = text;
}

function setBusy(button, busy) {
  button.disabled = busy;
  button.style.opacity = busy ? "0.65" : "";
}

function showOverwriteDialog({ coursewareCode, dataName, existingValue }) {
  overwriteMessage.textContent = `${coursewareCode} 已存在 ${dataName}，是否覆盖？`;
  overwriteExisting.textContent = existingValue ? `当前内容：${existingValue}` : "当前内容：已存在";
  modal.classList.add("open");
  return new Promise((resolve) => {
    pendingOverwriteResponse = resolve;
  });
}

function resolveOverwrite(action) {
  modal.classList.remove("open");
  if (pendingOverwriteResponse) {
    pendingOverwriteResponse({ action });
    pendingOverwriteResponse = null;
  }
}

async function send(type, button) {
  setBusy(button, true);
  log("正在处理，请稍候...");
  try {
    const response = await chrome.runtime.sendMessage({ type });
    log(JSON.stringify(response, null, 2));
  } catch (error) {
    log(String(error));
  } finally {
    setBusy(button, false);
  }
}

async function sendWithPayload(type, payload, button) {
  setBusy(button, true);
  log("正在处理，请稍候...");
  try {
    const response = await chrome.runtime.sendMessage({ type, ...payload });
    log(JSON.stringify(response, null, 2));
  } catch (error) {
    log(String(error));
  } finally {
    setBusy(button, false);
  }
}

function setSelectOptions(select, values) {
  select.textContent = "";
  for (const value of values || []) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  }
}

function chooseWorkbook(kind) {
  return new Promise(async (resolve) => {
    try {
      const response = await fetch(`http://127.0.0.1:8769/workbook-candidates?kind=${encodeURIComponent(kind)}`);
      const payload = await response.json();
      const candidates = payload.candidates || [];
      if (candidates.length <= 1) {
        resolve(candidates[0]?.path || "");
        return;
      }
      workbookChoice.textContent = "";
      for (const item of candidates) {
        const option = document.createElement("option");
        option.value = item.path;
        option.textContent = item.name;
        workbookChoice.appendChild(option);
      }
      pendingWorkbookChoice = resolve;
      workbookChoiceModal.classList.add("open");
    } catch (error) {
      log(`读取表格列表失败：${error.message || error}`);
      resolve(null);
    }
  });
}

function openAutoMatch(title, placeholder) {
  log(`已打开：${title}`);
  autoMatchTitle.textContent = title;
  autoMatchSearchName.value = "";
  autoMatchSearchName.placeholder = placeholder;
  autoMatchModal.classList.add("open");
  autoMatchSearchName.focus();
  return new Promise((resolve) => {
    pendingAutoMatch = resolve;
  });
}

async function openFillTemplateModal() {
  log("正在读取模板选项...");
  try {
    const response = await fetch("http://127.0.0.1:8769/template-options");
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || "读取模板选项失败。");
    for (const [name, id] of Object.entries(fillOptionIds)) {
      setSelectOptions(document.getElementById(id), payload.options?.[name] || []);
    }
    fillTemplateModal.classList.add("open");
  } catch (error) {
    log(`读取模板选项失败：${error.message || error}`);
  }
}

async function fillTemplate(button) {
  const payload = {};
  for (const [name, id] of Object.entries(fillOptionIds)) {
    payload[name] = document.getElementById(id).value;
  }
  setBusy(button, true);
  log("正在填入模板并下载封面...");
  try {
    const response = await fetch("http://127.0.0.1:8769/fill-template", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    log(JSON.stringify(result, null, 2));
  } catch (error) {
    log(String(error));
  } finally {
    setBusy(button, false);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "COURSEWARE_DATA_PROGRESS") {
    const percent = Number.isFinite(message.percent) ? ` ${message.percent}%` : "";
    const detail = message.message || "";
    log(`${detail}${percent}`);
    return false;
  }
  if (message.type === "CONFIRM_OVERWRITE") {
    showOverwriteDialog(message).then(sendResponse);
    return true;
  }
  return false;
});

toggle.addEventListener("click", () => {
  const open = !panel.classList.contains("open");
  panel.classList.toggle("open", open);
  toggle.setAttribute("aria-expanded", String(open));
  chevron.textContent = open ? "⌄" : "›";
});

dataCopyToggle.addEventListener("click", () => {
  const open = !dataCopyPanel.classList.contains("open");
  dataCopyPanel.classList.toggle("open", open);
  dataCopyToggle.setAttribute("aria-expanded", String(open));
  dataCopyChevron.textContent = open ? "⌄" : "›";
});

postlaunchToggle.addEventListener("click", () => {
  const open = !postlaunchPanel.classList.contains("open");
  postlaunchPanel.classList.toggle("open", open);
  postlaunchToggle.setAttribute("aria-expanded", String(open));
  postlaunchChevron.textContent = open ? "⌄" : "›";
});

document.getElementById("health").addEventListener("click", async (event) => {
  setBusy(event.currentTarget, true);
  try {
    const response = await fetch("http://127.0.0.1:8769/health");
    log(JSON.stringify(await response.json(), null, 2));
  } catch (error) {
    log("统一本地助手未启动，请先双击 run_prelaunch_assistant.bat。");
  } finally {
    setBusy(event.currentTarget, false);
  }
});

document.getElementById("overwriteOnce").addEventListener("click", () => resolveOverwrite("once"));
document.getElementById("overwriteAll").addEventListener("click", () => resolveOverwrite("all"));
document.getElementById("overwriteCancel").addEventListener("click", () => resolveOverwrite("cancel"));

document.getElementById("workbookChoiceStart").addEventListener("click", () => {
  workbookChoiceModal.classList.remove("open");
  if (pendingWorkbookChoice) pendingWorkbookChoice(workbookChoice.value);
  pendingWorkbookChoice = null;
});

document.getElementById("workbookChoiceCancel").addEventListener("click", () => {
  workbookChoiceModal.classList.remove("open");
  if (pendingWorkbookChoice) pendingWorkbookChoice(null);
  pendingWorkbookChoice = null;
});

document.getElementById("autoMatchStart").addEventListener("click", () => {
  const value = autoMatchSearchName.value.trim();
  if (!value) {
    log("请输入课件编码。");
    return;
  }
  log(`已输入课件编码：${value}`);
  autoMatchModal.classList.remove("open");
  if (pendingAutoMatch) pendingAutoMatch(value);
  pendingAutoMatch = null;
});

document.getElementById("autoMatchCancel").addEventListener("click", () => {
  autoMatchModal.classList.remove("open");
  if (pendingAutoMatch) pendingAutoMatch("");
  pendingAutoMatch = null;
});

document.getElementById("start").addEventListener("click", (event) => {
  sendWithPayload("START_UPLOAD", { configPath: "" }, event.currentTarget);
});

document.getElementById("dry").addEventListener("click", (event) => {
  sendWithPayload("DRY_RUN", { configPath: "" }, event.currentTarget);
});

document.getElementById("relationDry").addEventListener("click", (event) => {
  sendWithPayload("DRY_RELATION", { configPath: "" }, event.currentTarget);
});

document.getElementById("relationStart").addEventListener("click", (event) => {
  sendWithPayload("START_RELATION", { configPath: "" }, event.currentTarget);
});

document.getElementById("resourceCopyDry").addEventListener("click", (event) => {
  sendWithPayload("DRY_RESOURCE_COPY", { configPath: "" }, event.currentTarget);
});

document.getElementById("resourceCopyStart").addEventListener("click", (event) => {
  sendWithPayload("START_RESOURCE_COPY", { configPath: "" }, event.currentTarget);
});

document.getElementById("subjectNameUploadStart").addEventListener("click", (event) => {
  sendWithPayload("START_SUBJECT_NAME_UPLOAD", { configPath: "" }, event.currentTarget);
});

document.getElementById("copyCoursewareInfo").addEventListener("click", () => {
  coursewareSearchName.value = "";
  coursewareDataModal.classList.add("open");
  coursewareSearchName.focus();
});

document.getElementById("coursewareDataCancel").addEventListener("click", () => {
  coursewareDataModal.classList.remove("open");
});

document.getElementById("coursewareDataStart").addEventListener("click", async (event) => {
  const searchName = coursewareSearchName.value.trim();
  if (!searchName) {
    log("请输入要复制的课件编码。");
    return;
  }
  coursewareDataModal.classList.remove("open");
  setBusy(event.currentTarget, true);
  log(`正在扫描匹配数据：${searchName}`);
  try {
    const response = await chrome.runtime.sendMessage({ type: "COPY_COURSEWARE_DATA", searchName });
    log(JSON.stringify(response, null, 2));
  } catch (error) {
    log(String(error));
  } finally {
    setBusy(event.currentTarget, false);
  }
});

document.getElementById("fillTemplate").addEventListener("click", () => {
  openFillTemplateModal();
});

document.getElementById("uploadCoursewareInfo").addEventListener("click", async (event) => {
  await sendWithPayload("START_COURSEWARE_INFO_UPLOAD", { configPath: "" }, event.currentTarget);
});

document.getElementById("fillTemplateCancel").addEventListener("click", () => {
  fillTemplateModal.classList.remove("open");
});

document.getElementById("fillTemplateStart").addEventListener("click", async (event) => {
  fillTemplateModal.classList.remove("open");
  await fillTemplate(event.currentTarget);
});

document.getElementById("copySmallTeacher").addEventListener("click", () => {
  smallTeacherSearchName.value = "";
  smallTeacherModal.classList.add("open");
  smallTeacherSearchName.focus();
});

document.getElementById("smallTeacherCancel").addEventListener("click", () => {
  smallTeacherModal.classList.remove("open");
});

document.getElementById("smallTeacherStart").addEventListener("click", async (event) => {
  const searchName = smallTeacherSearchName.value.trim();
  if (!searchName) {
    log("请输入要复制的小老师课件编码。");
    return;
  }
  smallTeacherModal.classList.remove("open");
  setBusy(event.currentTarget, true);
  log(`正在扫描小老师数据：${searchName}`);
  try {
    const response = await chrome.runtime.sendMessage({ type: "COPY_SMALL_TEACHER_DATA", searchName });
    log(JSON.stringify(response, null, 2));
  } catch (error) {
    log(String(error));
  } finally {
    setBusy(event.currentTarget, false);
  }
});

document.getElementById("knowledgeCopyLocal").addEventListener("click", async (event) => {
  log("已点击：知识点复制 / 查询本地");
  await sendWithPayload("START_KNOWLEDGE_COPY_LOCAL", { configPath: "" }, event.currentTarget);
});

document.getElementById("knowledgeCopyAuto").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  log("已点击：知识点复制 / 自动匹配");
  const searchName = await openAutoMatch("知识点自动匹配（仅台-粤）", "例如：s4_v8_01_TW");
  if (!searchName) return;
  log(`开始知识点自动匹配：${searchName}`);
  await sendWithPayload("START_KNOWLEDGE_COPY_AUTO", { searchName }, button);
});

document.getElementById("smallTeacherUploadLocal").addEventListener("click", async (event) => {
  log("已点击：小老师复制 / 从本地上传");
  await sendWithPayload("START_SMALL_TEACHER_UPLOAD_LOCAL", { configPath: "" }, event.currentTarget);
});

document.getElementById("smallTeacherUploadAuto").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  log("已点击：小老师复制 / 自动匹配");
  const searchName = await openAutoMatch("小老师自动匹配（仅台-粤）", "例如：s4_v8_01_TW");
  if (!searchName) return;
  log(`开始小老师自动匹配：${searchName}`);
  await sendWithPayload("START_SMALL_TEACHER_UPLOAD_AUTO", { searchName }, button);
});
