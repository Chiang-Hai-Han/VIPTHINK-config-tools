const LOCAL = "http://127.0.0.1:8771";
const AIC_BASE = "https://aic-gw.vipthink.cn/api/aiclass-courseware/a/v1/eva/question";
const TOKEN_URL = "https://jy.vipthink.cn/gateway/route__jy/api_admin.php/core/route__edu_core/alioss/get_alioss_upload_token";
const ATTACHMENT_URL = "https://jy.vipthink.cn/gateway/route__jy/api_admin.php/core/route__edu_core/alioss/add_attachment";
const QUESTION_LIST_URL = `${AIC_BASE}/list`;
const QUESTION_DETAIL_URL = `${AIC_BASE}/detail`;
const QUESTION_EDIT_URL = `${AIC_BASE}/editOrAdd`;
let sessionId = "";

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    for (const header of details.requestHeaders || []) {
      if (header.name.toLowerCase() === "session-id" && header.value) {
        sessionId = header.value;
        chrome.storage.local.set({ topicVideoSessionId: sessionId });
      }
    }
  },
  { urls: ["https://jy.vipthink.cn/*"] },
  ["requestHeaders", "extraHeaders"]
);

function sendProgress(message) {
  chrome.runtime.sendMessage({ type: "TOPIC_VIDEO_PROGRESS", message }).catch(() => {});
}

async function getSessionId() {
  if (sessionId) return sessionId;
  const stored = await chrome.storage.local.get("topicVideoSessionId");
  sessionId = stored.topicVideoSessionId || "";
  if (!sessionId) {
    throw new Error("没有捕捉到 Session-Id。请先在后台页面刷新一次，再打开插件重试。");
  }
  return sessionId;
}

async function postJson(url, data) {
  const sid = await getSessionId();
  const headers = {
    "Accept": "application/json, text/plain, */*",
    "Content-Type": "application/json;charset=UTF-8",
    "Session-Id": sid
  };
  if (url.includes("aic-gw.vipthink.cn")) {
    headers.Authorization = sid;
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(data)
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${url}: ${text.slice(0, 500)}`);
  }
  return parsed;
}

async function localGet(path) {
  const response = await fetch(`${LOCAL}${path}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `本地接口失败：${path}`);
  }
  return payload;
}

async function localPost(path, data) {
  const response = await fetch(`${LOCAL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `本地接口失败：${path}`);
  }
  return payload;
}

function ext(filename) {
  const index = String(filename || "").lastIndexOf(".");
  return index >= 0 ? String(filename).slice(index) : ".mp4";
}

function guessMime(filename) {
  const lower = String(filename || "").toLowerCase();
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".m4v")) return "video/x-m4v";
  if (lower.endsWith(".webm")) return "video/webm";
  return "application/octet-stream";
}

function base64FromArrayBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function signOssPut({ accessKeyId, accessKeySecret, bucket, objectKey, date, contentType }) {
  const resource = `/${bucket}/${objectKey}`;
  const ossUserAgent = "aliyun-sdk-js/6.16.0";
  const canonicalizedOssHeaders = `x-oss-date:${date}\nx-oss-user-agent:${ossUserAgent}\n`;
  const stringToSign = `PUT\n\n${contentType}\n${date}\n${canonicalizedOssHeaders}${resource}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(accessKeySecret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(stringToSign));
  return `OSS ${accessKeyId}:${base64FromArrayBuffer(signature)}`;
}

async function uploadBlobToOss(blob, filename, config, prefix = "topic_video") {
  const objectKey = `${prefix}_${Date.now()}${ext(filename)}`;
  const url = `https://${config.bucket}.${config.region}.aliyuncs.com/${objectKey}`;
  const date = new Date().toUTCString();
  const mime = guessMime(filename);
  const authorization = await signOssPut({
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    bucket: config.bucket,
    objectKey,
    date,
    contentType: mime
  });
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": mime,
      "x-oss-date": date,
      "x-oss-user-agent": "aliyun-sdk-js/6.16.0",
      "Authorization": authorization
    },
    body: blob
  });
  if (!response.ok) {
    throw new Error(`OSS 上传失败：${response.status} ${await response.text()}`);
  }
  return { url, mime, size: blob.size, filename };
}

function listPayload(keyword) {
  return {
    categoryId: "2",
    status: "0",
    coursewareId: "",
    keyword,
    targetPointId: "",
    newKnowledgeId: "",
    subjectName: "",
    page: 1,
    limit: 50,
    subjectType: "0"
  };
}

async function findQuestionByName(questionName, keyword) {
  const result = await postJson(QUESTION_LIST_URL, listPayload(keyword || questionName));
  const rows = result.data || [];
  const exact = rows.find((row) => row.questionName === questionName);
  if (!exact) {
    throw new Error(`没有找到题目：${questionName}`);
  }
  return exact;
}

async function fetchQuestionDetail(questionId) {
  const result = await postJson(QUESTION_DETAIL_URL, { questionId });
  return result.data?.base || {};
}

async function fetchBlobFromUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载源视频失败：${response.status} ${url}`);
  }
  return response.blob();
}

function buildEditPayload(targetBase, attachmentId, uploaded, videoName) {
  return {
    categoryId: String(targetBase.categoryId ?? "2"),
    questionId: Number(targetBase.questionId),
    questionName: targetBase.questionName || "",
    coursewareId: Number(targetBase.coursewareId),
    coursewareName: targetBase.coursewareName || "",
    subjectId: Number(targetBase.subjectId ?? 0),
    subjectName: targetBase.subjectName || "",
    targetPointId: Number(targetBase.targetPointId ?? 0),
    secondTargetPointId: Number(targetBase.secondTargetPointId ?? 0),
    trueImgId: Number(targetBase.trueImgId ?? 0),
    difficultyDegree: Number(targetBase.difficultyDegree ?? 0),
    counselorAnalyze: targetBase.counselorAnalyze ?? null,
    counselorAnalyzeVideoId: String(attachmentId),
    counselorAnalyzeVideoUrl: uploaded.url,
    counselorAnalyzeVideoName: videoName || "",
    counselorAnalyzeVideoContent: videoName ? `${videoName}.mp4` : "",
    knowledgeId: String(targetBase.knowledgeId ?? ""),
    contentModuleName: targetBase.contentModuleId ?? 0,
    subjectType: String(targetBase.subjectType ?? "0")
  };
}

async function processTask(task, dryRun = false) {
  sendProgress(`正在处理第 ${task.row} 行：${task.source_title} -> ${task.target_title}`);

  const sourceRow = await findQuestionByName(task.source_title, task.source_code || task.source_title);
  const targetRow = await findQuestionByName(task.target_title, task.target_code || task.target_title);
  const sourceBase = await fetchQuestionDetail(sourceRow.questionId);
  const targetBase = await fetchQuestionDetail(targetRow.questionId);

  if (!sourceBase.counselorAnalyzeVideoUrl) {
    throw new Error(`来源题目没有指导视频：${task.source_title}`);
  }

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      sourceQuestionId: sourceRow.questionId,
      targetQuestionId: targetRow.questionId,
      sourceVideoUrl: sourceBase.counselorAnalyzeVideoUrl
    };
  }

  const blob = await fetchBlobFromUrl(sourceBase.counselorAnalyzeVideoUrl);
  const token = await postJson(TOKEN_URL, { publish_flag: 1 });
  const videoName = sourceBase.counselorAnalyzeVideoName || "topic_video.mp4";
  const uploaded = await uploadBlobToOss(blob, videoName, token.config, "topic_video");
  const attachment = await postJson(ATTACHMENT_URL, {
    mime: uploaded.mime,
    size: String(uploaded.size),
    url: uploaded.url,
    name: videoName
  });
  const payload = buildEditPayload(targetBase, attachment.id || attachment.data?.id || "", uploaded, videoName);
  const saved = await postJson(QUESTION_EDIT_URL, payload);
  return {
    ok: true,
    sourceQuestionId: sourceRow.questionId,
    targetQuestionId: targetRow.questionId,
    uploadedUrl: uploaded.url,
    attachmentId: String(attachment.id || attachment.data?.id || ""),
    saved
  };
}

async function runBatch(dryRun = false) {
  const payload = await localGet("/topic-video-tasks");
  const tasks = payload.tasks || [];
  if (!tasks.length) {
    return { ok: true, message: "没有待处理任务。" };
  }

  const results = [];
  for (const task of tasks) {
    try {
      const result = await processTask(task, dryRun);
      results.push({ row: task.row, ok: true, result });
      await localPost("/topic-video-result", {
        row: task.row,
        status: dryRun ? "空跑通过" : "已完成",
        note: dryRun
          ? `来源题目=${result.sourceQuestionId}；目标题目=${result.targetQuestionId}`
          : `来源题目=${result.sourceQuestionId}；目标题目=${result.targetQuestionId}；附件=${result.attachmentId}`
      });
      sendProgress(`第 ${task.row} 行完成`);
    } catch (error) {
      const message = String(error?.message || error);
      results.push({ row: task.row, ok: false, error: message });
      await localPost("/topic-video-result", {
        row: task.row,
        status: "失败",
        note: message
      });
      sendProgress(`第 ${task.row} 行失败：${message}`);
    }
  }
  return { ok: results.every((item) => item.ok), results };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === "HEALTH") {
      sendResponse(await localGet("/health"));
      return;
    }
    if (message.type === "DRY_TOPIC_VIDEO_COPY") {
      sendResponse(await runBatch(true));
      return;
    }
    if (message.type === "START_TOPIC_VIDEO_COPY") {
      sendResponse(await runBatch(false));
      return;
    }
    sendResponse({ ok: false, error: `未知消息：${message.type}` });
  })().catch((error) => {
    sendResponse({ ok: false, error: String(error?.message || error) });
  });
  return true;
});
