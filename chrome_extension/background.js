const LOCAL = "http://127.0.0.1:8769";
const BASE = "https://jy.vipthink.cn/gateway/route__jy/api_admin.php/core";
const LIST_URL = `${BASE}/route__edu_core/teacher_new/chapter_list`;
const NAME_CODE_URL = `${BASE}/route__edu_core/teacher_new/get_chapter_name_code`;
const DETAIL_URL = `${BASE}/teacher_new/add_edit_chapter_new`;
const TOKEN_URL = `${BASE}/route__edu_core/alioss/get_alioss_upload_token`;
const ATTACHMENT_URL = `${BASE}/route__edu_core/alioss/add_attachment`;
const SAVE_URL = `${BASE}/teacher_new/add_edit_chapter`;
const RELATION_LOCAL = "http://127.0.0.1:8769";
const WORK_INFO_URL = `${BASE}/route__edu_core/teacher_new/get_online_work_info_new`;
const WORK_ENUMS_URL = `${BASE}/route__edu_core/teacher_new/get_online_work_ques_enums`;
const SAVE_RELATION_URL = `${BASE}/route__edu_core/teacher_new/edit_online_work_new`;
const SMALL_TEACHER_URL = `${BASE}/route__edu_core/teacher/get_chapter_teacher_v2`;
const EDIT_SMALL_TEACHER_URL = `${BASE}/route__edu_core/teacher/edit_chapter_teacher_v2`;
const RESOURCE_COPY_LOCAL = "http://127.0.0.1:8769";
const RESOURCE_COPY_EXAMPLE = {
  target_code: "s4_v8_04_TW",
  source_code: "s4_v8_04_YY",
  target_id: "",
  source_id: ""
};
let sessionId = "";

class FlowCancelled extends Error {
  constructor(message = "用户取消，本次流程已中断。") {
    super(message);
    this.name = "FlowCancelled";
  }
}

function isFlowCancelled(error) {
  return error instanceof FlowCancelled || error?.name === "FlowCancelled";
}

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    for (const header of details.requestHeaders || []) {
      if (header.name.toLowerCase() === "session-id" && header.value) {
        sessionId = header.value;
        chrome.storage.local.set({ sessionId });
      }
    }
  },
  { urls: ["https://jy.vipthink.cn/gateway/*"] },
  ["requestHeaders", "extraHeaders"]
);

async function getSessionId() {
  if (sessionId) return sessionId;
  const stored = await chrome.storage.local.get("sessionId");
  sessionId = stored.sessionId || "";
  if (!sessionId) throw new Error("没有捕捉到 Session-Id。请先在课件管理页面点一次查询或刷新列表。");
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
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  if (!response.ok) throw new Error(`${response.status} ${url}: ${text.slice(0, 500)}`);
  return parsed;
}

async function confirmOverwriteIfNeeded(state, { coursewareCode, dataName, existingValue }) {
  if (state?.overwriteAll || !existingValue) return;
  let response;
  try {
    response = await chrome.runtime.sendMessage({
      type: "CONFIRM_OVERWRITE",
      coursewareCode,
      dataName,
      existingValue
    });
  } catch {
    throw new FlowCancelled("无法弹出覆盖确认，本次流程已中断。请保持插件弹窗打开后重试。");
  }
  const action = response?.action || "cancel";
  if (action === "all") {
    state.overwriteAll = true;
    return;
  }
  if (action === "once") return;
  throw new FlowCancelled();
}

function firstText(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "" && String(value).trim() !== "0") {
      return String(value).trim();
    }
  }
  return "";
}

function coverExistingValue(row, detail) {
  return firstText(detail?.cover_url_path, row?.cover_url_path, detail?.cover_url, row?.cover_url);
}

function relationExistingValue(existing) {
  if (!existing || Object.keys(existing).length === 0) return "";
  const chapterId = firstText(existing.chapter_id, existing.chapterId);
  const liveChapterId = firstText(existing.live_chapter_id, existing.liveChapterId);
  const relationId = firstText(existing.id, existing.work_id, existing.workId);
  if (!chapterId && !liveChapterId && !relationId) return "";
  return firstText(
    existing.name,
    existing.chapter_name,
    chapterId,
    liveChapterId,
    relationId
  );
}

function completedResult(task, dataName, actionName) {
  const code = task.courseware_code || task.source_code || task.target_code || task.code || "";
  return {
    ok: true,
    skipped: true,
    completed: true,
    row: task.row,
    code,
    data_name: dataName,
    action: actionName,
    message: `${code} 的 ${dataName} 已经完成 ${actionName}`,
  };
}

function resourceCopyExistingValue(target) {
  const existing = [];
  const homeworkCount = Number(target?.new_work_num || target?.work_num || target?.newWorkNum || target?.workNum || 0);
  const reportId = Number(target?.report_id || target?.reportId || 0);
  const workId = Number(target?.work_id || target?.workId || target?.every_work_id || target?.everyWorkId || 0);
  const courseResourceData = target?.course_res_data || target?.courseResData || "";
  const workDetail = target?.work_detail || target?.workDetail || "";
  if (homeworkCount > 0) existing.push(`作业题目 ${homeworkCount} 条`);
  if (workId > 0) existing.push(`作业资源 id=${workId}`);
  if (reportId > 0) existing.push(`学习报告 id=${reportId}`);
  if (courseResourceData && courseResourceData !== "null" && courseResourceData !== "[]") existing.push("课件资源数据已存在");
  if (workDetail && workDetail !== "null" && workDetail !== "[]") existing.push("作业详情已存在");
  return existing.join("；");
}

function knowledgeCopyExistingValue(target) {
  const count = Number(
    target?.new_point_num ||
    target?.point_num ||
    target?.newPointNum ||
    target?.pointNum ||
    target?.knowledge_collection_num ||
    target?.knowledgeCollectionNum ||
    0
  );
  if (count > 0) return `知识点 ${count} 条`;
  const relation = Number(target?.knowledge_collection_relation || target?.knowledgeCollectionRelation || 0);
  if (relation > 0) return `知识点关联状态=${relation}`;
  return "";
}

function queryPayload(code) {
  return {
    page: 1,
    page_size: 10,
    total: 0,
    sort: "create_time",
    order: "desc",
    date_type: "create_time",
    start_time: "",
    end_time: "",
    chapter_type: "",
    preheat_status: "-1",
    opt_date_type: "",
    course_category_id: "",
    chapter_namecode: code,
    _where_ex: "",
    status: "",
    chaper_difficulty: "0",
    upload_type: "0",
    upload_status: "-1",
    collection_upload_status: "0",
    collection_relation_status: "0",
    chapter_language_type: "",
    subject_ids: "0"
  };
}

function uniqueRows(rows) {
  const seen = new Set();
  const result = [];
  for (const row of rows || []) {
    const code = row?.game_url;
    if (!code || seen.has(code)) continue;
    seen.add(code);
    result.push(row);
  }
  return result;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSearchName(value) {
  return String(value || "").trim();
}

function expandRangePattern(searchName) {
  const match = searchName.match(/^(.*_)(\d{2,3})~(\d{2,3})(_.*)$/);
  if (!match) return null;
  const [, prefix, startText, endText, suffix] = match;
  const start = Number(startText);
  const end = Number(endText);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
    throw new Error("范围格式不正确，请确认起止数字，例如 s4_v8_01~50_TW。");
  }
  const width = startText.length;
  return Array.from({ length: end - start + 1 }, (_, index) => {
    const number = String(start + index).padStart(width, "0");
    return `${prefix}${number}${suffix}`;
  });
}

async function queryCoursewareRows(searchText, pageSize = 200) {
  const result = await postJson(LIST_URL, { ...queryPayload(searchText), page_size: pageSize });
  return uniqueRows(result?.out?.list || []);
}

async function queryWildcardCoursewares(searchName) {
  const wildcard = searchName.match(/^(.*_)xx(_.*)$/i);
  if (!wildcard) return null;
  const [, prefix, suffix] = wildcard;
  const searchText = prefix.replace(/_$/, "") || suffix.replace(/^_/, "");
  const rows = await queryCoursewareRows(searchText, 1000);
  const pattern = new RegExp(`^${escapeRegExp(prefix)}\\d{2,3}${escapeRegExp(suffix)}$`);
  return rows.filter((row) => pattern.test(row.game_url));
}

async function resolveCoursewareRows(searchName) {
  const normalized = normalizeSearchName(searchName);
  if (!normalized) throw new Error("请输入要抓取的课件编码。");

  const wildcardRows = await queryWildcardCoursewares(normalized);
  if (wildcardRows) return wildcardRows;

  const rangeCodes = expandRangePattern(normalized);
  if (rangeCodes) {
    const rows = [];
    for (const code of rangeCodes) {
      rows.push(await queryCourseware(code));
    }
    return rows;
  }

  return [await queryCourseware(normalized)];
}

async function queryCourseware(code) {
  const result = await postJson(LIST_URL, queryPayload(code));
  const rows = result?.out?.list || [];
  const exact = rows.filter((row) => row.game_url === code);
  if (exact.length === 1) return exact[0];

  const nameCodeResult = await postJson(NAME_CODE_URL, { namecode: code });
  const nameCodeRows = nameCodeResult?.data || [];
  const nameCodeExact = nameCodeRows.filter((row) => row.game_url === code);
  if (nameCodeExact.length !== 1) {
    throw new Error(`编码 ${code} 精确匹配数为 ${exact.length}/${nameCodeExact.length}，查询返回 ${rows.length}/${nameCodeRows.length} 条。`);
  }
  return { ...nameCodeExact[0], id: nameCodeExact[0].id || nameCodeExact[0].value };
}

function stripHtml(value) {
  if (value === undefined || value === null) return "";
  return String(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function normalizeParagraphs(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\s*(?:<p\b[^>]*>.*?<\/p>\s*)+$/is.test(raw)) return raw;
  if (!/[\r\n]/.test(raw)) return raw;
  return raw
    .split(/\r\n|\r|\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${part}</p>`)
    .join("");
}

function findValueByKeys(source, keys, visited = new Set()) {
  if (!source || typeof source !== "object") return "";
  if (visited.has(source)) return "";
  visited.add(source);

  const wanted = new Set(keys.map((key) => String(key).toLowerCase()));
  for (const [key, value] of Object.entries(source)) {
    if (wanted.has(String(key).toLowerCase()) && value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  for (const value of Object.values(source)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findValueByKeys(item, keys, visited);
        if (found !== "") return found;
      }
    } else if (value && typeof value === "object") {
      const found = findValueByKeys(value, keys, visited);
      if (found !== "") return found;
    }
  }

  return "";
}

function detailText(detail, keys) {
  return stripHtml(findValueByKeys(detail, keys));
}

function mapCoursewareData(row, detail) {
  return {
    "列表_课件名称": firstText(row?.chapter_name, row?.name, row?.label),
    "列表_课件代码": firstText(row?.game_url),
    "列表_课程封面": firstText(row?.cover_url_path, row?.cover_url),
    "详情_课件名称": detailText(detail, ["chapter_name", "chapterName", "name"]),
    "详情_内容名称": detailText(detail, [
      "table_name",
      "tableName",
      "content_name",
      "contentName",
      "chapter_content_name",
      "chapterContentName",
      "chapter_contents_name",
      "chapterContentsName",
      "content_title",
      "contentTitle",
      "contents_name",
      "contentsName",
      "content",
      "sub_title",
      "subTitle",
      "title"
    ]),
    "详情_课件编码": detailText(detail, ["game_url", "chapter_code", "namecode"]),
    "详情_教学目标": detailText(detail, [
      "description",
      "teach_target",
      "teachTarget",
      "teaching_target",
      "teachingTarget",
      "teaching_goal",
      "teachingGoal",
      "target",
      "goal"
    ]),
    "详情_课节简介": detailText(detail, [
      "about",
      "chapter_intro",
      "chapterIntro",
      "chapter_introduce",
      "chapterIntroduce",
      "lesson_intro",
      "lessonIntro",
      "lesson_introduce",
      "lessonIntroduce",
      "lesson_description",
      "lessonDescription",
      "lesson_desc",
      "lessonDesc",
      "section_intro",
      "sectionIntro",
      "chapter_brief",
      "chapterBrief",
      "chapter_summary",
      "chapterSummary",
      "course_intro",
      "courseIntro",
      "class_intro",
      "classIntro",
      "class_hour_intro",
      "classHourIntro",
      "brief",
      "intro",
      "introduce",
      "summary"
    ])
  };
}

function sendCoursewareProgress(stage, payload = {}) {
  chrome.runtime.sendMessage({ type: "COURSEWARE_DATA_PROGRESS", stage, ...payload }).catch(() => {});
}

function sendStatus(message, payload = {}) {
  sendCoursewareProgress("status", { message, ...payload });
}

async function fetchCoursewareData(searchName) {
  sendCoursewareProgress("scan", { message: "正在扫描匹配数据..." });
  const rows = await resolveCoursewareRows(searchName);
  const total = rows.length;
  sendCoursewareProgress("scanned", { total, percent: total ? 0 : 100, message: `已扫描到 ${total} 条数据。` });
  const dataRows = [];
  const failures = [];
  for (const [index, row] of rows.entries()) {
    const current = index + 1;
    sendCoursewareProgress("processing", {
      total,
      current,
      percent: Math.floor(((current - 1) / total) * 100),
      code: row?.game_url || "",
      message: `正在处理 ${current}/${total}：${row?.game_url || ""}`
    });
    try {
      const detail = await postJson(DETAIL_URL, { id: row.id, cn_ids: row.cn_ids });
      dataRows.push(mapCoursewareData(row, detail));
    } catch (error) {
      failures.push({ code: row?.game_url || "", error: String(error.message || error) });
    }
    sendCoursewareProgress("processing", {
      total,
      current,
      percent: Math.floor((current / total) * 100),
      code: row?.game_url || "",
      message: `已完成 ${current}/${total}（${Math.floor((current / total) * 100)}%）`
    });
  }
  sendCoursewareProgress("saving", { total, percent: 100, message: "正在保存 Excel..." });
  const response = await fetch(`${LOCAL}/courseware-data-result`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ searchName, rows: dataRows, failures })
  });
  const saved = await response.json().catch(() => ({}));
  if (!response.ok || saved.ok === false) throw new Error(saved.error || "本地保存课件信息失败。");
  sendCoursewareProgress("done", { total, percent: 100, message: `复制完成：${dataRows.length} 条。` });
  return { ok: failures.length === 0, count: dataRows.length, failures, path: saved.path };
}

function valueByKeys(source, keys) {
  if (!source || typeof source !== "object") return "";
  const wanted = keys.map((key) => key.toLowerCase());
  for (const [key, value] of Object.entries(source)) {
    const lower = key.toLowerCase();
    if (wanted.some((name) => lower.includes(name)) && value !== undefined && value !== null && String(value).trim()) {
      return stripHtml(value);
    }
  }
  return "";
}

function nestedValueByKeys(source, keys) {
  const direct = valueByKeys(source, keys);
  if (direct) return direct;
  const visited = new Set();
  const walk = (value) => {
    if (!value || typeof value !== "object" || visited.has(value)) return "";
    visited.add(value);
    const found = valueByKeys(value, keys);
    if (found) return found;
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") {
        const nested = walk(child);
        if (nested) return nested;
      }
    }
    return "";
  };
  return walk(source);
}

function mapSmallTeacherItem(code, item) {
  const imageFromMultiple = Array.isArray(item?.image_file_multiple) && item.image_file_multiple.length
    ? item.image_file_multiple[0]?.url || ""
    : "";
  return {
    "课件编码": code,
    "建议主题": stripHtml(item?.name || nestedValueByKeys(item, ["title", "theme", "topic", "subject", "name"])),
    "录制建议": stripHtml(item?.advice || nestedValueByKeys(item, ["advice", "suggest", "record", "content", "desc"])),
    "图片资源": stripHtml(imageFromMultiple || item?.image_url || item?.imageUrl || nestedValueByKeys(item, ["image", "img", "pic", "url", "cover"]))
  };
}

async function fetchSmallTeacherData(searchName) {
  sendCoursewareProgress("scan", { message: "正在扫描小老师匹配数据..." });
  const rows = await resolveCoursewareRows(searchName);
  const total = rows.length;
  const dataRows = [];
  const failures = [];
  sendCoursewareProgress("scanned", { total, percent: total ? 0 : 100, message: `已扫描到 ${total} 条数据。` });

  for (const [index, row] of rows.entries()) {
    const current = index + 1;
    const code = row?.game_url || "";
    sendCoursewareProgress("processing", {
      total,
      current,
      percent: Math.floor(((current - 1) / total) * 100),
      message: `正在处理小老师 ${current}/${total}：${code}`
    });
    try {
      const result = await postJson(SMALL_TEACHER_URL, { chapter_id: String(row.id) });
      const questionList = result?.data?.question_config_list || [];
      if (!questionList.length) failures.push({ code, error: "接口返回中没有小老师题目。" });
      for (const item of questionList) {
        dataRows.push(mapSmallTeacherItem(code, item));
      }
    } catch (error) {
      failures.push({ code, error: String(error.message || error) });
    }
    sendCoursewareProgress("processing", {
      total,
      current,
      percent: Math.floor((current / total) * 100),
      message: `小老师已完成 ${current}/${total}（${Math.floor((current / total) * 100)}%）`
    });
  }

  const response = await fetch(`${LOCAL}/small-teacher-result`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ searchName, rows: dataRows, failures })
  });
  const saved = await response.json().catch(() => ({}));
  if (!response.ok || saved.ok === false) throw new Error(saved.error || "本地保存小老师数据失败。");
  return { ok: failures.length === 0, count: dataRows.length, failures, path: saved.path, image_dir: saved.image_dir };
}

function extractCnPath(detail) {
  const paths = [];
  const chapterOne = detail?.chapter?.chapter_one || [];
  for (const level1 of chapterOne) {
    for (const level2 of level1.children || []) {
      for (const level3 of level2.children || []) {
        paths.push([String(level1.value), String(level2.value), String(level3.value)]);
      }
    }
  }
  if (paths.length) return { paths, cnId: paths[0][2] };
  if (detail.cn_ids) return { paths: [[String(detail.cn_ids)]], cnId: String(detail.cn_ids) };
  throw new Error("详情中没有 cn_ids。");
}

/**
 * 解析详情中的 cn_ids，支持 _hw 后缀课件的兼容处理。
 * _hw 课件（作业课件）的详情中可能没有 chapter.chapter_one 或 cn_ids，
 * 此时自动查找父级课件（去掉 _hw 后缀）的详情来获取 cn_ids。
 */
async function resolveCnForSave(detail, coursewareCode) {
  try {
    return extractCnPath(detail);
  } catch (error) {
    // _hw 课件详情缺少 cn_ids 时，尝试从父级课件获取
    const hwMatch = coursewareCode.match(/^(.+)_hw$/i);
    if (!hwMatch) throw error;
    const parentCode = hwMatch[1];
    const parentRow = await queryCourseware(parentCode);
    const parentDetail = await postJson(DETAIL_URL, { id: parentRow.id, cn_ids: parentRow.cn_ids });
    return extractCnPath(parentDetail);
  }
}
function normalizeForSave(detail, attachmentId) {
  const data = { ...detail };
  const { paths, cnId } = extractCnPath(detail);
  if (attachmentId !== undefined && attachmentId !== null) data.cover_url = String(attachmentId);
  data.cn_ids = paths;
  delete data.info;
  delete data.code;
  delete data.ret;
  delete data.chapter;

  for (const key of ["chapter_type", "remedial_teach_chapter_id", "ai_class_chapter_id"]) {
    if (data[key] !== null && data[key] !== "" && data[key] !== undefined) {
      const value = Number(data[key]);
      if (!Number.isNaN(value)) data[key] = value;
    }
  }
  if (typeof data.live_chapter_config === "string" && data.live_chapter_config) {
    try { data.live_chapter_config = JSON.parse(data.live_chapter_config); } catch {}
  }
  if (data.record_chapter_config === null || data.record_chapter_config === "") {
    data.record_chapter_config = [];
  }
  return { data, cnId };
}

function guessMime(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function ext(filename) {
  const idx = filename.lastIndexOf(".");
  return idx >= 0 ? filename.slice(idx) : ".jpg";
}

function base64FromArrayBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
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

async function uploadToOss(task, config) {
  const imageResponse = await fetch(`${LOCAL}/image?code=${encodeURIComponent(task.courseware_code)}`);
  if (!imageResponse.ok) throw new Error(`读取本地图片失败：${await imageResponse.text()}`);
  const blob = await imageResponse.blob();
  const filename = task.image_path.split(/[\\/]/).pop() || `${task.courseware_code}.jpg`;
  return uploadBlobToOss(blob, filename, config, "realia_add");
}

async function uploadBlobToOss(blob, filename, config, prefix = "realia_add") {
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
      "x-oss-user-agent": "aliyun-sdk-js/6.1.0",
      "Authorization": authorization
    },
    body: blob
  });
  if (!response.ok) throw new Error(`OSS 上传失败：${response.status} ${await response.text()}`);
  return { url, filename, mime, size: blob.size };
}

function filenameFromHeadersOrUrl(response, fallback) {
  const headerName = response.headers.get("X-File-Name") || "";
  if (headerName) return headerName;
  try {
    const urlPath = new URL(response.url).pathname;
    const name = decodeURIComponent(urlPath.split("/").pop() || "");
    if (name && name.includes(".")) return name;
  } catch {}
  return fallback;
}

async function processTask(task, dryRun, overwriteState) {
  const row = await queryCourseware(task.courseware_code);
  const detail = await postJson(DETAIL_URL, { id: row.id, cn_ids: row.cn_ids });
  if (dryRun) return { ok: true, code: task.courseware_code, id: row.id, dryRun: true };

  await confirmOverwriteIfNeeded(overwriteState, {
    coursewareCode: task.courseware_code,
    dataName: "封面图片",
    existingValue: coverExistingValue(row, detail)
  });

  const token = await postJson(TOKEN_URL, { publish_flag: 1 });
  const uploaded = await uploadToOss(task, token.config);
  const attachment = await postJson(ATTACHMENT_URL, {
    mime: uploaded.mime,
    size: uploaded.size,
    url: uploaded.url,
    name: uploaded.filename
  });
  // _hw 课件兼容：详情缺少 cn_ids 时从父级课件获取
  const { cnId: resolvedCnId } = await resolveCnForSave(detail, task.courseware_code);
  detail.cn_ids = resolvedCnId;

  const { data, cnId } = normalizeForSave(detail, attachment.id);
  const saved = await postJson(SAVE_URL, { data: JSON.stringify(data), cn_ids: cnId });
  return {
    ok: true,
    code: task.courseware_code,
    id: row.id,
    attachmentId: attachment.id,
    url: uploaded.url,
    save: saved
  };
}

async function fetchCoursewareInfoUploadTasks(configPath = "") {
  const response = await fetch(localUrl("/courseware-info-upload-tasks", { config: configPath }));
  if (!response.ok) throw new Error(`课件信息配置表读取失败：${await response.text()}`);
  const payload = await response.json();
  return payload.tasks || [];
}

function applyCoursewareInfo(detail, task) {
  if (task.courseware_name) detail.chapter_name = task.courseware_name;
  if (task.content_name) detail.table_name = task.content_name;
  if (task.teaching_goal) detail.description = normalizeParagraphs(task.teaching_goal);
  if (task.lesson_intro) detail.about = normalizeParagraphs(task.lesson_intro);
}

async function processCoursewareInfoUploadTask(task) {
  const code = task.courseware_code || task.code || "";
  if (!code) throw new Error("课件信息任务缺少课件编码。");
  sendStatus(`正在上传课件信息：${code}`);
  const row = await queryCourseware(code);
  const detail = await postJson(DETAIL_URL, { id: row.id, cn_ids: row.cn_ids });
  const { cnId: resolvedCnId } = await resolveCnForSave(detail, code);
  detail.cn_ids = resolvedCnId;
  applyCoursewareInfo(detail, task);
  const { data, cnId } = normalizeForSave(detail);
  const saved = await postJson(SAVE_URL, { data: JSON.stringify(data), cn_ids: cnId });
  return {
    ok: true,
    row: task.row,
    code,
    id: String(row.id),
    save: saved
  };
}

async function runCoursewareInfoUpload(configPath = "") {
  sendStatus("正在读取课件信息上传任务");
  const tasks = await fetchCoursewareInfoUploadTasks(configPath);
  sendStatus(`课件信息上传共 ${tasks.length} 条任务`);
  const results = [];
  for (const task of tasks) {
    try {
      results.push(await processCoursewareInfoUploadTask(task));
    } catch (error) {
      const result = {
        ok: false,
        row: task.row,
        code: task.courseware_code || "",
        error: String(error.message || error)
      };
      results.push(result);
      sendStatus(`课件信息上传失败：${result.code} ${result.error}`);
    }
  }
  return { ok: results.every((item) => item.ok), count: results.length, results };
}

async function fetchSubjectNameUploadTasks(configPath = "") {
  const response = await fetch(localUrl("/subject-name-upload-tasks", { config: configPath }));
  if (!response.ok) throw new Error(`专题名称配置表读取失败：${await response.text()}`);
  const payload = await response.json();
  return payload.tasks || [];
}

async function processSubjectNameUploadTask(task) {
  const code = task.courseware_code || task.code || "";
  const subjectName = firstText(task.subject_name);
  if (!code) throw new Error("专题名称任务缺少课件编码。");
  if (!subjectName) throw new Error(`${code} 的专题名称为空。`);
  sendStatus(`正在上传专题名称：${code}`);
  const row = await queryCourseware(code);
  const detail = await postJson(DETAIL_URL, { id: row.id, cn_ids: row.cn_ids });
  const { cnId: resolvedCnId } = await resolveCnForSave(detail, code);
  detail.cn_ids = resolvedCnId;
  detail.subject_name = subjectName;
  const { data, cnId } = normalizeForSave(detail);
  const saved = await postJson(SAVE_URL, { data: JSON.stringify(data), cn_ids: cnId });
  return {
    ok: true,
    row: task.row,
    code,
    id: String(row.id),
    subject_name: subjectName,
    save: saved
  };
}

async function runSubjectNameUpload(configPath = "") {
  sendStatus("正在读取专题名称上传任务");
  const tasks = await fetchSubjectNameUploadTasks(configPath);
  sendStatus(`专题名称上传共 ${tasks.length} 条任务`);
  const results = [];
  for (const task of tasks) {
    try {
      results.push(await processSubjectNameUploadTask(task));
    } catch (error) {
      const result = {
        ok: false,
        row: task.row,
        code: task.courseware_code || "",
        error: String(error.message || error)
      };
      results.push(result);
      sendStatus(`专题名称上传失败：${result.code} ${result.error}`);
    }
  }
  return { ok: results.every((item) => item.ok), count: results.length, results };
}

async function report(result) {
  await fetch(`${LOCAL}/result`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(result)
  });
}

async function reportRelation(result) {
  await fetch(`${RELATION_LOCAL}/relation-result`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(result)
  });
}

async function reportResourceCopy(result) {
  await fetch(`${RESOURCE_COPY_LOCAL}/resource-copy-result`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(result)
  });
}

async function fetchRelationTasks(configPath = "") {
  const response = await fetch(localUrl("/relation-tasks", { config: configPath }));
  if (!response.ok) throw new Error(`本地关联助手未启动：${await response.text()}`);
  const payload = await response.json();
  return payload.tasks || [];
}

function localUrl(path, params = {}) {
  const url = new URL(`${RESOURCE_COPY_LOCAL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value) !== "") url.searchParams.set(key, value);
  }
  return url.toString();
}

async function fetchResourceCopyTasks(configPath = "") {
  const response = await fetch(localUrl("/resource-copy-tasks", { config: configPath }));
  if (!response.ok) throw new Error(`资源复制本地助手未启动：${await response.text()}`);
  const payload = await response.json();
  return payload.tasks || [];
}

async function fetchKnowledgeCopyTasks(configPath = "") {
  const response = await fetch(localUrl("/knowledge-copy-tasks", { config: configPath }));
  if (!response.ok) throw new Error(`知识点复制本地助手未启动：${await response.text()}`);
  const payload = await response.json();
  return payload.tasks || [];
}

async function fetchResourceCopyTemplate() {
  const response = await fetch(`${RESOURCE_COPY_LOCAL}/resource-copy-template`);
  if (!response.ok) throw new Error(`资源复制模板不可用：${await response.text()}`);
  const payload = await response.json();
  if (!payload.ok || !payload.template) throw new Error(payload.error || "资源复制模板为空，请先监听一次真实复制操作。");
  return payload.template;
}

async function queryHomeworkCourseware(code) {
  const result = await postJson(WORK_ENUMS_URL, { work_name: code });
  const rows = result?.chapter_list || result?.data?.chapter_list || [];
  const exact = rows.filter((row) => row.game_url === code);
  if (exact.length === 1) return exact[0];
  return queryCourseware(code);
}

async function getExistingRelation(sourceId) {
  const result = await postJson(WORK_INFO_URL, { chapter_id: String(sourceId), type: 1 });
  return result?.data || {};
}

function buildRelationPayload(source, target, existing) {
  const existingId = existing?.id || existing?.work_id || existing?.workId || null;
  return {
    work_info: JSON.stringify({
      chapter_id: String(target.id),
      name: existing?.name || source.chapter_name || target.chapter_name || "",
      status: "1",
      id: existingId,
      live_chapter_id: String(source.id)
    }),
    type: 1
  };
}

function isSuccessResponse(result) {
  return result?.code === 0 || result?.code === 200 || result?.ret === 0 || result?.info === "succ" || result?.ok === true;
}

async function processRelationTask(task, dryRun, overwriteState) {
  const sourceCode = task.source_code || task.sourceCode || task.courseware_code || task.code;
  const targetCode = task.target_code || task.targetCode || task.homework_code || `${sourceCode}_hw`;
  if (!sourceCode || !targetCode) throw new Error("关联任务缺少 source_code 或 target_code。");

  const source = await queryCourseware(sourceCode);
  const target = await queryHomeworkCourseware(targetCode);
  const existing = await getExistingRelation(source.id);
  const payload = buildRelationPayload(source, target, existing);

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      source_code: sourceCode,
      target_code: targetCode,
      source_id: String(source.id),
      target_id: String(target.id),
      existing_work_id: existing?.id || null,
      save_payload: payload
    };
  }

  await confirmOverwriteIfNeeded(overwriteState, {
    coursewareCode: sourceCode,
    dataName: "线上作业关联",
    existingValue: relationExistingValue(existing)
  });

  const saved = await postJson(SAVE_RELATION_URL, payload);
  if (!isSuccessResponse(saved)) {
    throw new Error(`保存线上作业关联失败：${JSON.stringify(saved)}`);
  }
  return {
    ok: true,
    source_code: sourceCode,
    target_code: targetCode,
    source_id: String(source.id),
    target_id: String(target.id),
    work_id: saved.work_id || saved.workId || existing?.id || existing?.work_id || null,
    save: saved
  };
}

async function runRelation(dryRun, configPath = "") {
  const tasks = await fetchRelationTasks(configPath);
  const results = [];
  const overwriteState = { overwriteAll: false };
  for (const task of tasks) {
    try {
      if (task.completed) {
        results.push(completedResult(task, "线上作业关联", "关联"));
        continue;
      }
      const result = await processRelationTask(task, dryRun, overwriteState);
      await reportRelation(result);
      results.push(result);
    } catch (error) {
      if (isFlowCancelled(error)) {
        return { ok: false, cancelled: true, count: results.length, results, error: error.message };
      }
      const result = {
        ok: false,
        source_code: task.source_code || task.sourceCode || task.courseware_code || task.code || "",
        target_code: task.target_code || task.targetCode || task.homework_code || "",
        error: String(error.message || error)
      };
      await reportRelation(result);
      results.push(result);
    }
  }
  return { ok: results.every((item) => item.ok), count: results.length, results };
}

function replaceAll(value, replacements) {
  if (typeof value !== "string") return value;
  let next = value;
  for (const [from, to] of replacements) {
    if (!from || to === undefined || to === null) continue;
    next = next.split(String(from)).join(String(to));
  }
  return next;
}

function setResourceTypes(body, resources) {
  if (body && typeof body === "object" && Array.isArray(body.resources)) {
    return { ...body, resources };
  }
  return body;
}

function buildResourceCopyRequest(task, source, target, template, resources = null) {
  const example = template?.example || RESOURCE_COPY_EXAMPLE;
  const postData =
    template?.postData ||
    JSON.stringify({
      target_chapter_id: example.target_id || "__TARGET_ID__",
      source_chapter_id: example.source_id || "__SOURCE_ID__",
      target_game_url: example.target_code,
      source_game_url: example.source_code
    });
  const replacements = [
    [example.source_code, task.source_code],
    [example.target_code, task.target_code],
    [example.source_id, source.id],
    [example.target_id, target.id],
    ["__SOURCE_ID__", source.id],
    ["__TARGET_ID__", target.id]
  ];
  const bodyText = replaceAll(postData, replacements);
  let body;
  try { body = JSON.parse(bodyText); } catch { body = bodyText; }
  if (resources) body = setResourceTypes(body, resources);
  else if (body && typeof body === "object" && Array.isArray(body.resources)) {
    body = setResourceTypes(body, body.resources.filter((resource) => Number(resource) !== 5));
  }
  if (!template?.url) throw new Error("资源复制模板缺少接口地址，请先监听一次真实复制操作。");
  return { url: replaceAll(template.url, replacements), body };
}

async function processResourceCopyTask(task, dryRun, template, overwriteState, options = {}) {
  const targetCode = task.target_code || task.targetCode || task.config_code || task.courseware_code || task.code;
  const sourceCode = task.source_code || task.sourceCode || task.copy_from_code || task.from_code;
  if (!targetCode || !sourceCode) throw new Error("资源复制任务缺少 target_code 或 source_code。");

  const target = await queryCourseware(targetCode);
  const source = await queryCourseware(sourceCode);
  const request = buildResourceCopyRequest({ target_code: targetCode, source_code: sourceCode }, source, target, task.template || template, options.resources || null);

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      target_code: targetCode,
      source_code: sourceCode,
      target_id: String(target.id),
      source_id: String(source.id),
      request
    };
  }

  await confirmOverwriteIfNeeded(overwriteState, {
    coursewareCode: targetCode,
    dataName: options.dataName || "资源（作业题目、学习报告）",
    existingValue: options.existingValue ? options.existingValue(target) : resourceCopyExistingValue(target)
  });

  const saved = await postJson(request.url, request.body);
  if (saved?.code !== 0 && saved?.code !== 200 && saved?.ret !== 0 && saved?.info !== "succ" && saved?.ok !== true) {
    throw new Error(`资源复制失败：${JSON.stringify(saved)}`);
  }
  return {
    ok: true,
    target_code: targetCode,
    source_code: sourceCode,
    target_id: String(target.id),
    source_id: String(source.id),
    save: saved
  };
}

async function runResourceCopy(dryRun, configPath = "") {
  const tasks = await fetchResourceCopyTasks(configPath);
  const template = await fetchResourceCopyTemplate();
  if (template.example?.target_code && template.example?.source_code) {
    const exampleTarget = await queryCourseware(template.example.target_code);
    const exampleSource = await queryCourseware(template.example.source_code);
    template.example.target_id = String(template.example.target_id || exampleTarget.id);
    template.example.source_id = String(template.example.source_id || exampleSource.id);
  }
  const results = [];
  const overwriteState = { overwriteAll: false };
  for (const task of tasks) {
    try {
      if (task.completed) {
        results.push(completedResult(task, "资源复制", "复制"));
        continue;
      }
      const result = await processResourceCopyTask(task, dryRun, template, overwriteState);
      result.row = task.row;
      await reportResourceCopy(result);
      results.push(result);
    } catch (error) {
      if (isFlowCancelled(error)) {
        return { ok: false, cancelled: true, count: results.length, results, error: error.message };
      }
      const result = {
        ok: false,
        row: task.row,
        target_code: task.target_code || task.targetCode || task.config_code || task.courseware_code || task.code || "",
        source_code: task.source_code || task.sourceCode || task.copy_from_code || task.from_code || "",
        error: String(error.message || error)
      };
      await reportResourceCopy(result);
      results.push(result);
    }
  }
  return { ok: results.every((item) => item.ok), count: results.length, results };
}

async function runKnowledgeCopyFromLocal(configPath = "") {
  const tasks = await fetchKnowledgeCopyTasks(configPath);
  const template = await fetchResourceCopyTemplate();
  const results = [];
  const overwriteState = { overwriteAll: false };
  for (const task of tasks) {
    try {
      const result = await processResourceCopyTask(task, false, template, overwriteState, {
        resources: [2],
        dataName: "知识点资源",
        existingValue: knowledgeCopyExistingValue
      });
      results.push(result);
    } catch (error) {
      if (isFlowCancelled(error)) return { ok: false, cancelled: true, count: results.length, results, error: error.message };
      results.push({
        ok: false,
        target_code: task.target_code || "",
        source_code: task.source_code || "",
        error: String(error.message || error)
      });
    }
  }
  return { ok: results.every((item) => item.ok), count: results.length, results };
}

async function runKnowledgeCopyAuto(searchName) {
  const rows = await resolveCoursewareRows(searchName);
  const tasks = rows.map((row) => ({
    target_code: row.game_url,
    source_code: row.game_url.replace(/_TW$/i, "_YY")
  }));
  const template = await fetchResourceCopyTemplate();
  const results = [];
  const overwriteState = { overwriteAll: false };
  for (const task of tasks) {
    try {
      const result = await processResourceCopyTask(task, false, template, overwriteState, {
        resources: [2],
        dataName: "知识点资源",
        existingValue: knowledgeCopyExistingValue
      });
      results.push(result);
    } catch (error) {
      if (isFlowCancelled(error)) return { ok: false, cancelled: true, count: results.length, results, error: error.message };
      results.push({ ok: false, ...task, error: String(error.message || error) });
    }
  }
  return { ok: results.every((item) => item.ok), count: results.length, results };
}

async function fetchSmallTeacherUploadTasks(configPath = "") {
  const response = await fetch(localUrl("/small-teacher-upload-tasks", { config: configPath }));
  if (!response.ok) throw new Error(`小老师配置表读取失败：${await response.text()}`);
  const payload = await response.json();
  return payload.tasks || [];
}

async function getSmallTeacherDetail(chapterId) {
  const result = await postJson(SMALL_TEACHER_URL, { chapter_id: String(chapterId) });
  if (!isSuccessResponse(result)) throw new Error(`读取小老师失败：${JSON.stringify(result)}`);
  return result?.data || {};
}

function smallTeacherHasContent(detail) {
  if (!detail) return false;
  if (String(detail.status || "") === "1") return true;
  return (detail.question_config_list || []).some((item) =>
    firstText(item?.name, item?.advice, item?.image_file) ||
    (Array.isArray(item?.image_file_multiple) && item.image_file_multiple.length)
  );
}

function smallTeacherExistingValue(detail) {
  const items = detail?.question_config_list || [];
  const first = items.find((item) =>
    firstText(item?.name, item?.advice, item?.image_file) ||
    (Array.isArray(item?.image_file_multiple) && item.image_file_multiple.length)
  );
  if (!first && !detail?.status) return "";
  const image = Array.isArray(first?.image_file_multiple) && first.image_file_multiple.length ? "有图片" : "";
  return firstText(first?.name, stripHtml(first?.advice || ""), image, detail?.status ? `状态=${detail.status}` : "");
}

function smallTeacherImageUrl(item) {
  if (Array.isArray(item?.image_file_multiple) && item.image_file_multiple.length) {
    return firstText(item.image_file_multiple[0]?.url, item.image_file_multiple[0]?.path);
  }
  return firstText(item?.image_file, item?.image_url, item?.imageUrl);
}

async function registerSmallTeacherImage({ image, targetCode, row }) {
  let imageResponse;
  let fallbackName = `小老师${targetCode}.jpg`;
  if (/^https?:\/\//i.test(image) || image.startsWith("//")) {
    const url = image.startsWith("//") ? `https:${image}` : image;
    imageResponse = await fetch(url);
  } else {
    if (!image && !row) return "";
    imageResponse = await fetch(localUrl("/small-teacher-image", { row, code: targetCode }));
  }
  if (!imageResponse.ok) throw new Error(`读取小老师图片失败：${await imageResponse.text()}`);
  const blob = await imageResponse.blob();
  const originalName = filenameFromHeadersOrUrl(imageResponse, fallbackName);
  const filename = `小老师${targetCode}${ext(originalName)}`;
  const token = await postJson(TOKEN_URL, { publish_flag: 1 });
  const uploaded = await uploadBlobToOss(blob, filename, token.config, "little_teacher");
  const attachment = await postJson(ATTACHMENT_URL, {
    mime: uploaded.mime,
    size: uploaded.size,
    url: uploaded.url,
    name: filename
  });
  return String(attachment.id || attachment.data?.id || "");
}

function buildSmallTeacherSavePayload(targetRow, targetDetail, item, attachmentId) {
  const question = {
    advice: item.advice || "",
    avdio_file: Number(item.avdio_file || 0),
    level: item.level || "17_1",
    image_file_multiple: attachmentId || "",
    name: item.name || ""
  };
  return {
    chapter_id: Number(targetRow.id),
    chapter_name: targetDetail.chapter_name || targetRow.chapter_name || targetRow.name || targetRow.game_url,
    status: "1",
    control_time: Number(targetDetail.control_time || 0),
    question_config_list: JSON.stringify([question])
  };
}

async function processSmallTeacherUploadTask(task, overwriteState) {
  const targetCode = task.target_code || task.code || task.courseware_code;
  if (!targetCode) throw new Error("小老师任务缺少课件编码。");
  sendStatus(`小老师本地上传：${targetCode}`);
  const targetRow = await queryCourseware(targetCode);
  sendStatus(`已找到目标课件：${targetCode}，id=${targetRow.id}`);
  const targetDetail = await getSmallTeacherDetail(targetRow.id);
  sendStatus(`已读取目标小老师：${targetCode}`);

  await confirmOverwriteIfNeeded(overwriteState, {
    coursewareCode: targetCode,
    dataName: "小老师配置",
    existingValue: smallTeacherExistingValue(targetDetail)
  });

  const attachmentId = await registerSmallTeacherImage({
    image: task.image || "",
    targetCode,
    row: task.row
  });
  sendStatus(attachmentId ? `本地图片已上传：attachment_id=${attachmentId}` : `本地上传未提供图片：${targetCode}`);
  const payload = buildSmallTeacherSavePayload(targetRow, targetDetail, {
    name: task.name || "",
    advice: task.advice || "",
    level: task.level || targetDetail.question_config_list?.[0]?.level || "17_1",
    avdio_file: task.avdio_file || 0
  }, attachmentId);
  const saved = await postJson(EDIT_SMALL_TEACHER_URL, payload);
  if (!isSuccessResponse(saved)) throw new Error(`保存小老师失败：${JSON.stringify(saved)}`);
  sendStatus(`小老师本地上传完成：${targetCode}`);
  return {
    ok: true,
    row: task.row,
    target_code: targetCode,
    target_id: String(targetRow.id),
    attachment_id: attachmentId,
    save: saved
  };
}

async function processSmallTeacherAutoTask(targetRow, overwriteState) {
  const targetCode = targetRow.game_url;
  const sourceCode = targetCode.replace(/_TW$/i, "_YY");
  if (sourceCode === targetCode) throw new Error(`${targetCode} 不是 _TW 结尾，无法自动匹配 YY 来源。`);
  sendStatus(`小老师自动匹配：${targetCode} <- ${sourceCode}`);
  const sourceRow = await queryCourseware(sourceCode);
  sendStatus(`已找到来源课件：${sourceCode}，id=${sourceRow.id}`);
  const sourceDetail = await getSmallTeacherDetail(sourceRow.id);
  sendStatus(`已读取来源小老师：${sourceCode}`);
  const sourceItem = (sourceDetail.question_config_list || []).find((item) =>
    firstText(item?.name, item?.advice) || smallTeacherImageUrl(item)
  );
  if (!sourceItem) throw new Error(`${sourceCode} 没有可复制的小老师内容。`);
  sendStatus(`来源内容：主题${sourceItem.name ? "有" : "无"}，建议${sourceItem.advice ? "有" : "无"}，图片${smallTeacherImageUrl(sourceItem) ? "有" : "无"}`);

  const targetDetail = await getSmallTeacherDetail(targetRow.id);
  sendStatus(`已读取目标小老师：${targetCode}`);
  await confirmOverwriteIfNeeded(overwriteState, {
    coursewareCode: targetCode,
    dataName: "小老师配置",
    existingValue: smallTeacherExistingValue(targetDetail)
  });

  const imageUrl = smallTeacherImageUrl(sourceItem);
  sendStatus(imageUrl ? `正在处理图片：${targetCode}` : `来源没有图片，将只提交文字：${targetCode}`);
  const attachmentId = await registerSmallTeacherImage({
    image: imageUrl,
    targetCode,
    row: ""
  });
  sendStatus(attachmentId ? `图片已上传：attachment_id=${attachmentId}` : `未上传图片：${targetCode}`);
  const payload = buildSmallTeacherSavePayload(targetRow, targetDetail, {
    name: sourceItem.name || "",
    advice: sourceItem.advice || "",
    level: sourceItem.level || "17_1",
    avdio_file: 0
  }, attachmentId);
  sendStatus(`正在保存小老师：${targetCode}`);
  const saved = await postJson(EDIT_SMALL_TEACHER_URL, payload);
  if (!isSuccessResponse(saved)) throw new Error(`保存小老师失败：${JSON.stringify(saved)}`);
  sendStatus(`小老师自动匹配完成：${targetCode}`);
  return {
    ok: true,
    target_code: targetCode,
    source_code: sourceCode,
    target_id: String(targetRow.id),
    source_id: String(sourceRow.id),
    attachment_id: attachmentId,
    save: saved
  };
}

async function runSmallTeacherUploadFromLocal(configPath = "") {
  sendStatus("正在读取小老师配置表");
  const tasks = await fetchSmallTeacherUploadTasks(configPath);
  sendStatus(`小老师本地上传共 ${tasks.length} 条任务`);
  const results = [];
  const overwriteState = { overwriteAll: false };
  for (const task of tasks) {
    try {
      if (task.completed) {
        results.push(completedResult(task, "小老师配置", "上传"));
        continue;
      }
      const result = await processSmallTeacherUploadTask(task, overwriteState);
      results.push(result);
    } catch (error) {
      if (isFlowCancelled(error)) return { ok: false, cancelled: true, count: results.length, results, error: error.message };
      results.push({
        ok: false,
        row: task.row,
        target_code: task.target_code || "",
        error: String(error.message || error)
      });
    }
  }
  return { ok: results.every((item) => item.ok), count: results.length, results };
}

async function runSmallTeacherUploadAuto(searchName) {
  sendStatus(`正在解析小老师自动匹配输入：${searchName}`);
  const rows = await resolveCoursewareRows(searchName);
  sendStatus(`小老师自动匹配共 ${rows.length} 条任务`);
  const results = [];
  const overwriteState = { overwriteAll: false };
  for (const row of rows) {
    try {
      sendStatus(`开始处理：${row.game_url}`);
      results.push(await processSmallTeacherAutoTask(row, overwriteState));
    } catch (error) {
      if (isFlowCancelled(error)) return { ok: false, cancelled: true, count: results.length, results, error: error.message };
      sendStatus(`小老师自动匹配失败：${row.game_url || ""} ${String(error.message || error)}`);
      results.push({
        ok: false,
        target_code: row.game_url || "",
        source_code: row.game_url?.replace(/_TW$/i, "_YY") || "",
        error: String(error.message || error)
      });
    }
  }
  return { ok: results.every((item) => item.ok), count: results.length, results };
}

async function run(dryRun, configPath = "") {
  const tasksResponse = await fetch(localUrl("/tasks", { config: configPath }));
  if (!tasksResponse.ok) throw new Error("本地上传助手未启动。");
  const payload = await tasksResponse.json();
  const tasks = (payload.tasks || []).filter((task) => task.image_exists);
  const results = [];
  const overwriteState = { overwriteAll: false };
  for (const task of tasks) {
    try {
      if (task.completed) {
        results.push(completedResult(task, "封面图片", "上传"));
        continue;
      }
      const result = await processTask(task, dryRun, overwriteState);
      result.note = dryRun ? "dry-run ok" : `attachment_id=${result.attachmentId}; url=${result.url}`;
      await report(result);
      results.push(result);
    } catch (error) {
      if (isFlowCancelled(error)) {
        return { ok: false, cancelled: true, count: results.length, results, error: error.message };
      }
      const result = { ok: false, code: task.courseware_code, error: String(error.message || error) };
      await report(result);
      results.push(result);
    }
  }
  return { ok: results.every((item) => item.ok), count: results.length, results };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "COPY_COURSEWARE_DATA") {
    fetchCoursewareData(message.searchName)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }
  if (message.type === "COPY_SMALL_TEACHER_DATA") {
    fetchSmallTeacherData(message.searchName)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }
  if (message.type === "START_RESOURCE_COPY" || message.type === "DRY_RESOURCE_COPY") {
    runResourceCopy(message.type === "DRY_RESOURCE_COPY", message.configPath || "")
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }
  if (message.type === "START_COURSEWARE_INFO_UPLOAD") {
    runCoursewareInfoUpload(message.configPath || "")
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }
  if (message.type === "START_SUBJECT_NAME_UPLOAD") {
    runSubjectNameUpload(message.configPath || "")
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }
  if (message.type === "START_KNOWLEDGE_COPY_LOCAL") {
    runKnowledgeCopyFromLocal(message.configPath || "")
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }
  if (message.type === "START_KNOWLEDGE_COPY_AUTO") {
    runKnowledgeCopyAuto(message.searchName || "")
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }
  if (message.type === "START_SMALL_TEACHER_UPLOAD_LOCAL") {
    runSmallTeacherUploadFromLocal(message.configPath || "")
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }
  if (message.type === "START_SMALL_TEACHER_UPLOAD_AUTO") {
    runSmallTeacherUploadAuto(message.searchName || "")
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }
  if (message.type === "START_RELATION" || message.type === "DRY_RELATION") {
    runRelation(message.type === "DRY_RELATION", message.configPath || "")
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }
  const dryRun = message.type === "DRY_RUN";
  if (message.type !== "START_UPLOAD" && message.type !== "DRY_RUN") return false;
  run(dryRun, message.configPath || "").then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
  return true;
});

