const LOCAL = "http://127.0.0.1:8771";
const BASE = "https://jy.vipthink.cn/gateway/route__jy/api_admin.php/core";
const PLAN_LIST_URL = `${BASE}/teacher_new/plan`;
const PLAN_EDIT_URL = `${BASE}/teacher_new/plan_edit`;
const PLAN_DETAIL_URL = `${BASE}/teacher_new/get_plan_detail`;
const PLAN_STATUS_URL = `${BASE}/teacher_new/update_plan_status`;
const DOWNLOAD_URL = `${BASE}/route__edu_core/alioss/get_alioss_download`;
const TOKEN_URL = `${BASE}/route__edu_core/alioss/get_alioss_upload_token`;
const ATTACHMENT_URL = `${BASE}/route__edu_core/alioss/add_attachment`;
const LOCALE_SUFFIX_RE = /_(TW|YY|HK|HW|CN|MO|SG|MY)$/i;

let sessionId = "";

function emitProgress(payload) {
  chrome.runtime.sendMessage({
    type: "JIANAN_PROGRESS",
    ...payload,
  }).catch(() => {});
}

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    for (const header of details.requestHeaders || []) {
      if (header.name.toLowerCase() === "session-id" && header.value) {
        sessionId = header.value;
        chrome.storage.local.set({ jiananSessionId: sessionId });
      }
    }
  },
  { urls: ["https://jy.vipthink.cn/gateway/*"] },
  ["requestHeaders", "extraHeaders"]
);

async function getSessionId() {
  if (sessionId) return sessionId;
  const stored = await chrome.storage.local.get("jiananSessionId");
  sessionId = stored.jiananSessionId || "";
  if (!sessionId) {
    throw new Error("No Session-Id captured. Refresh the plan page first.");
  }
  return sessionId;
}

async function readLocal(path, options = {}) {
  const response = await fetch(`${LOCAL}${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Request failed: ${path}`);
  }
  return payload;
}

async function postJson(url, data) {
  const sid = await getSessionId();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json;charset=UTF-8",
      "Session-Id": sid,
    },
    body: JSON.stringify(data),
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

function isSuccessResponse(result) {
  return result?.ret === 0 || result?.code === 0 || result?.info === "succ" || result?.ok === true;
}

function ext(filename) {
  const match = String(filename || "").match(/(\.[A-Za-z0-9]+)(?:[?#].*)?$/);
  return match ? match[1] : "";
}

function filenameFromHeadersOrUrl(response, fallback) {
  const disposition = response.headers.get("content-disposition") || response.headers.get("Content-Disposition") || "";
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const plainMatch = disposition.match(/filename="?([^"]+)"?/i);
  if (plainMatch) return plainMatch[1];
  try {
    const pathname = new URL(response.url).pathname.split("/").pop();
    if (pathname) return decodeURIComponent(pathname);
  } catch {}
  return fallback;
}

function base64FromArrayBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function guessMime(filename) {
  const extension = ext(filename).toLowerCase();
  switch (extension) {
    case ".pdf":
      return "application/pdf";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".xls":
      return "application/vnd.ms-excel";
    case ".doc":
      return "application/msword";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".ppt":
      return "application/vnd.ms-powerpoint";
    case ".pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}

async function signOssPut({ accessKeyId, accessKeySecret, bucket, objectKey, date, contentType }) {
  const resource = `/${bucket}/${objectKey}`;
  const ossUserAgent = "aliyun-sdk-js/6.1.0";
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

async function uploadBlobToOss(blob, filename, config, prefix = "realia_add") {
  const objectKey = `${prefix}_${Date.now()}${ext(filename)}`;
  const url = `https://${config.bucket}.${config.region}.aliyuncs.com/${objectKey}`;
  const mime = guessMime(filename);
  const date = new Date().toUTCString();
  const authorization = await signOssPut({
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    bucket: config.bucket,
    objectKey,
    date,
    contentType: mime,
  });

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": mime,
      "x-oss-date": date,
      "x-oss-user-agent": "aliyun-sdk-js/6.1.0",
      Authorization: authorization,
    },
    body: blob,
  });
  if (!response.ok) {
    throw new Error(`OSS upload failed: ${response.status} ${await response.text()}`);
  }

  return {
    url,
    size: blob.size,
    mime,
    objectKey,
    filename,
  };
}

function queryPlanPayload(courseCategoryId, code, page = 1) {
  const categoryText = String(courseCategoryId || "").trim();
  const parts = categoryText.split(",").map((item) => item.trim()).filter(Boolean);
  const catePid = parts[0] || "";
  const cateSid = parts[1] || "";
  return {
    course_category_id: courseCategoryId,
    cate_pid: catePid,
    cate_sid: cateSid,
    game_url: code,
    chapter_namecode: code,
    keyword: code,
    order: "asc",
    page,
    page_count: 100,
    page_num: page,
    sort: "cn.sort",
    subject: "-1",
  };
}

function uniquePayloads(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildPlanQueryCandidates(courseCategoryId, code) {
  const withCategory = queryPlanPayload(courseCategoryId, code, 1);
  const withoutCategory = queryPlanPayload("", code, 1);
  return uniquePayloads([
    { ...withCategory, game_url: code, chapter_namecode: code, keyword: code },
    { ...withCategory, game_url: code, chapter_namecode: "", keyword: "" },
    { ...withCategory, game_url: "", chapter_namecode: code, keyword: code },
    { ...withCategory, game_url: "", chapter_namecode: "", keyword: code },
    { ...withoutCategory, game_url: code, chapter_namecode: code, keyword: code },
    { ...withoutCategory, game_url: code, chapter_namecode: "", keyword: "" },
    { ...withoutCategory, game_url: "", chapter_namecode: code, keyword: code },
    { ...withoutCategory, game_url: "", chapter_namecode: "", keyword: code },
  ]);
}

function responseRows(result) {
  return result?.out?.list || result?.data?.list || [];
}

function responsePageInfo(result) {
  return result?.out?.page_info || result?.data?.page_info || {};
}

async function queryPlanRows(courseCategoryId, code) {
  const candidates = buildPlanQueryCandidates(courseCategoryId, code);

  const allRows = [];
  const seen = new Set();
  const normalizedCode = String(code || "").trim().toLowerCase();

  for (const payload of candidates) {
    const first = await postJson(PLAN_LIST_URL, payload);
    const firstList = responseRows(first);
    const pageInfo = responsePageInfo(first);
    const total = Number(pageInfo.total || first?.out?.total || first?.data?.total || firstList.length || 0);
    const pageSize = Number(pageInfo.page_size || payload.page_count || 10);
    const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

    for (const row of firstList) {
      const key = String(row?.id || "") || `${row?.game_url || ""}-${row?.sort || ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        allRows.push(row);
      }
    }

    for (let page = 2; page <= totalPages; page += 1) {
      const next = await postJson(PLAN_LIST_URL, { ...payload, page, page_num: page });
      const list = responseRows(next);
      for (const row of list) {
        const key = String(row?.id || "") || `${row?.game_url || ""}-${row?.sort || ""}`;
        if (!seen.has(key)) {
          seen.add(key);
          allRows.push(row);
        }
      }
    }

    if (allRows.some((row) => String(row?.game_url || "").trim().toLowerCase() === normalizedCode)) {
      break;
    }
  }

  return allRows;
}

async function queryExactPlan(courseCategoryId, code, cache) {
  const cacheKey = `${String(courseCategoryId || "").trim()}__${String(code || "").trim()}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const rowsCacheKey = `rows__${cacheKey}`;
  const rows = cache.has(rowsCacheKey) ? cache.get(rowsCacheKey) : await queryPlanRows(courseCategoryId, code);
  cache.set(rowsCacheKey, rows);
  const normalizedCode = String(code || "").trim().toLowerCase();
  const exact = rows.find((row) => String(row?.game_url || "").trim().toLowerCase() === normalizedCode);
  if (!exact) {
    throw new Error(`Plan record not found for ${code}.`);
  }
  cache.set(cacheKey, exact);
  return exact;
}

async function getPlanDetail(planRow, cache) {
  const cacheKey = `detail__${String(planRow?.id || "")}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const detail = await postJson(PLAN_DETAIL_URL, {
    id: String(planRow.id || ""),
    class_type: String(planRow.cate_pid || ""),
    class_level: String(planRow.cate_sid || ""),
  });
  const plan = detail?.plan || detail?.data?.plan || detail;
  cache.set(cacheKey, plan);
  return plan;
}

async function downloadAliOssFile(fileId, fallbackName = "source.pdf") {
  const result = await postJson(DOWNLOAD_URL, { public_flag: 1, file_url: String(fileId) });
  const downloadUrl = result?.data?.url || result?.url || result?.out?.url || result?.download_url || result?.downloadUrl;
  if (!downloadUrl) {
    throw new Error(`Download url missing for file ${fileId}.`);
  }
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Download file failed: ${response.status}`);
  }
  const blob = await response.blob();
  const filename = filenameFromHeadersOrUrl(response, fallbackName);
  return { blob, filename, url: downloadUrl };
}

async function registerUploadedFile(fileBlob, filename) {
  const token = await postJson(TOKEN_URL, { publish_flag: 1 });
  const uploaded = await uploadBlobToOss(fileBlob, filename, token.config, "realia_add");
  const attachment = await postJson(ATTACHMENT_URL, {
    mime: uploaded.mime,
    size: uploaded.size,
    url: uploaded.url,
    name: filename,
  });
  return String(attachment.id || attachment.data?.id || "");
}

function shouldUseThinkGameRule(sourceCode) {
  const normalized = String(sourceCode || "").trim().toUpperCase();
  return Boolean(normalized) && !LOCALE_SUFFIX_RE.test(normalized);
}

function normalizePlanAttachmentField(value) {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) {
    return value.length ? JSON.stringify(value) : "";
  }
  if (typeof value === "number") {
    return "";
  }

  if (typeof value === "string") {
    const text = value.trim();
    if (!text || text === "0" || text.toLowerCase() === "null" || text.toLowerCase() === "undefined") {
      return "";
    }
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.length ? JSON.stringify(parsed) : "";
      }
    } catch {
      return "";
    }
    return "";
  }

  if (typeof value === "object") {
    return "";
  }

  return "";
}

function buildPlanEditPayload(targetPlan, sourceJaneCase) {
  return {
    chapter_id: String(targetPlan.id || ""),
    jane_case: String(sourceJaneCase || "0"),
    plan_file: String(targetPlan.plan_file ?? "0"),
    guide_video: targetPlan.guide_video ?? null,
    attention: normalizePlanAttachmentField(targetPlan.attention),
    befor_lesson_files: normalizePlanAttachmentField(targetPlan.befor_lesson_files),
    after_lesson_files: normalizePlanAttachmentField(targetPlan.after_lesson_files),
    point_guide: normalizePlanAttachmentField(targetPlan.point_guide),
    think_game: String(targetPlan.think_game ?? "0"),
    note: targetPlan.note ?? "",
    plan_status: String(targetPlan.plan_status ?? "0"),
    ppt: String(targetPlan.ppt ?? "0"),
  };
}

async function publishPlan(targetPlan) {
  const result = await postJson(PLAN_STATUS_URL, {
    id: String(targetPlan.id || ""),
    plan_status: "1",
  });
  if (!isSuccessResponse(result)) {
    throw new Error(`Publish failed: ${JSON.stringify(result).slice(0, 500)}`);
  }
  return result;
}

async function reportResults(results) {
  await readLocal("/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ results }),
  });
}

async function runPlanCopy(dryRun) {
  const sid = await getSessionId();
  const localPlan = await readLocal("/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dryRun, sessionId: sid }),
  });
  const tasks = localPlan.tasks || [];
  const results = [];
  const planCache = new Map();
  const total = tasks.length;

  emitProgress({
    stage: "start",
    total,
    current: 0,
    percent: 0,
    message: dryRun ? "开始检查任务..." : "开始执行任务...",
  });

  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    const current = index + 1;
    const baseResult = {
      row: task.row,
      source_code: task.source_code,
      target_code: task.target_code,
      download_status: "FAILED",
      upload_status: "FAILED",
      note: "",
    };

    try {
      emitProgress({
        stage: "task_start",
        total,
        current,
        percent: Math.floor(((current - 1) / Math.max(1, total)) * 100),
        source_code: task.source_code,
        target_code: task.target_code,
        message: `正在处理 ${current}/${total}: ${task.source_code} -> ${task.target_code}`,
      });

      if (!task.source_code || !task.target_code) {
        results.push({
          ...baseResult,
          note: "Missing source_code or target_code.",
        });
        emitProgress({
          stage: "task_error",
          total,
          current,
          percent: Math.floor((current / Math.max(1, total)) * 100),
          source_code: task.source_code,
          target_code: task.target_code,
          message: `第 ${task.row} 行缺少来源或目标课件代码。`,
        });
        continue;
      }

      emitProgress({
        stage: "search_source",
        total,
        current,
        percent: Math.floor(((current - 1) / Math.max(1, total)) * 100),
        source_code: task.source_code,
        target_code: task.target_code,
        message: `正在查找来源课件: ${task.source_code}`,
      });
      const sourcePlan = await queryExactPlan(task.source_course_category_id || "", task.source_code, planCache);
      emitProgress({
        stage: "search_target",
        total,
        current,
        percent: Math.floor(((current - 1) / Math.max(1, total)) * 100),
        source_code: task.source_code,
        target_code: task.target_code,
        message: `正在查找目标课件: ${task.target_code}`,
      });
      const targetPlan = await queryExactPlan(task.target_course_category_id || "", task.target_code, planCache);
      emitProgress({
        stage: "load_detail",
        total,
        current,
        percent: Math.floor(((current - 1) / Math.max(1, total)) * 100),
        source_code: task.source_code,
        target_code: task.target_code,
        message: `正在读取来源资料: ${task.source_code}`,
      });
      const sourceDetail = await getPlanDetail(sourcePlan, planCache);
      const sourceJaneCase = String(sourcePlan?.jane_case || sourceDetail?.jane_case || "0");
      const sourceThinkGame = String(sourcePlan?.think_game || sourceDetail?.think_game || "0");

      let finalJaneCase = sourceJaneCase;
      let ruleName = "copy_jane_case";

      if (shouldUseThinkGameRule(task.source_code)) {
        ruleName = "think_game_to_jane_case";
        if (!sourceThinkGame || sourceThinkGame === "0") {
          results.push({
            ...baseResult,
            note: `Source plan missing think_game: ${task.source_code}`,
          });
          continue;
        }
        if (dryRun) {
          finalJaneCase = `download:${sourceThinkGame}`;
        } else {
          emitProgress({
            stage: "download_source",
            total,
            current,
            percent: Math.floor(((current - 1) / Math.max(1, total)) * 100),
            source_code: task.source_code,
            target_code: task.target_code,
            message: `正在下载知识链解析: ${task.source_code}`,
          });
          const downloaded = await downloadAliOssFile(sourceThinkGame, `${task.source_code}_think_game.pdf`);
          emitProgress({
            stage: "upload_target",
            total,
            current,
            percent: Math.floor(((current - 1) / Math.max(1, total)) * 100),
            source_code: task.source_code,
            target_code: task.target_code,
            message: `正在上传到目标课程培训: ${task.target_code}`,
          });
          finalJaneCase = await registerUploadedFile(downloaded.blob, downloaded.filename || `${task.source_code}_think_game.pdf`);
        }
      } else {
        if (!sourceJaneCase || sourceJaneCase === "0") {
          results.push({
            ...baseResult,
            note: `Source plan missing jane_case: ${task.source_code}`,
          });
          continue;
        }
      }

      const payload = buildPlanEditPayload(targetPlan, finalJaneCase);

      if (dryRun) {
        results.push({
          ...baseResult,
          download_status: "CHECKED",
          upload_status: "CHECKED",
          note: `rule=${ruleName}; source_jane_case=${sourceJaneCase}; source_think_game=${sourceThinkGame}; target_chapter_id=${targetPlan.id}; target_plan_status=${targetPlan.plan_status ?? ""}; will_publish=1`,
        });
        emitProgress({
          stage: "task_done",
          total,
          current,
          percent: Math.floor((current / Math.max(1, total)) * 100),
          source_code: task.source_code,
          target_code: task.target_code,
          message: `检查完成 ${current}/${total}: ${task.target_code}`,
        });
        continue;
      }

      emitProgress({
        stage: "save_plan",
        total,
        current,
        percent: Math.floor(((current - 1) / Math.max(1, total)) * 100),
        source_code: task.source_code,
        target_code: task.target_code,
        message: `正在保存简案: ${task.target_code}`,
      });
      const saved = await postJson(PLAN_EDIT_URL, payload);
      if (!isSuccessResponse(saved)) {
        throw new Error(`Save failed: ${JSON.stringify(saved).slice(0, 500)}`);
      }

      emitProgress({
        stage: "publish_plan",
        total,
        current,
        percent: Math.floor(((current - 1) / Math.max(1, total)) * 100),
        source_code: task.source_code,
        target_code: task.target_code,
        message: `正在上架目标课件: ${task.target_code}`,
      });
      await publishPlan(targetPlan);

      results.push({
        ...baseResult,
        download_status: "READY",
        upload_status: "COPIED",
        note: `rule=${ruleName}; final_jane_case=${finalJaneCase}; source_jane_case=${sourceJaneCase}; source_think_game=${sourceThinkGame}; target_chapter_id=${targetPlan.id}; published=1`,
      });
      emitProgress({
        stage: "task_done",
        total,
        current,
        percent: Math.floor((current / Math.max(1, total)) * 100),
        source_code: task.source_code,
        target_code: task.target_code,
        message: `已完成 ${current}/${total}: ${task.target_code}`,
      });
    } catch (error) {
      results.push({
        ...baseResult,
        note: String(error?.message || error),
      });
      emitProgress({
        stage: "task_error",
        total,
        current,
        percent: Math.floor((current / Math.max(1, total)) * 100),
        source_code: task.source_code,
        target_code: task.target_code,
        message: `执行失败 ${current}/${total}: ${task.target_code} - ${String(error?.message || error)}`,
      });
    }
  }

  await reportResults(results);
  const successCount = results.filter((item) => item.upload_status === "COPIED" || item.upload_status === "CHECKED").length;
  emitProgress({
    stage: "finished",
    total,
    current: total,
    percent: 100,
    success_count: successCount,
    message: dryRun
      ? `检查完成：${successCount}/${total} 条可处理。`
      : `执行完成：成功 ${successCount}/${total} 条。`,
    results,
  });
  return {
    ok: successCount === results.length,
    count: results.length,
    success_count: successCount,
    results,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PREPARE_WORKBOOK") {
    readLocal("/prepare-workbook", { method: "POST" }).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: String(error?.message || error) });
    });
    return true;
  }

  if (message.type === "OPEN_CONFIG_HELP") {
    readLocal("/config-help").then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: String(error?.message || error) });
    });
    return true;
  }

  if (message.type === "CAPTURE_GUIDE") {
    readLocal("/capture-guide").then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: String(error?.message || error) });
    });
    return true;
  }

  if (message.type === "RUN_CAPTURE") {
    readLocal("/run-capture", { method: "POST" }).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: String(error?.message || error) });
    });
    return true;
  }

  if (message.type === "DRY_RUN_JIANAN") {
    runPlanCopy(true).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: String(error?.message || error) });
    });
    return true;
  }

  if (message.type === "START_JIANAN") {
    runPlanCopy(false).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: String(error?.message || error) });
    });
    return true;
  }

  return false;
});
