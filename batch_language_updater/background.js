const BASE = "https://jy.vipthink.cn/gateway/route__jy/api_admin.php/core";
const LIST_URL = `${BASE}/route__edu_core/teacher_new/chapter_list`;
const NAME_CODE_URL = `${BASE}/route__edu_core/teacher_new/get_chapter_name_code`;
const DETAIL_URL = `${BASE}/teacher_new/add_edit_chapter_new`;
const SAVE_URL = `${BASE}/teacher_new/add_edit_chapter`;

let sessionId = "";

/* ─── Session ─── */
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

/* ─── 编码匹配工具 ─── */

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

async function queryCoursewareRows(searchText, pageSize) {
  const result = await postJson(LIST_URL, { ...queryPayload(searchText), page_size: pageSize || 200 });
  return uniqueRows(result?.out?.list || []);
}

async function queryWildcardCoursewares(searchName) {
  const wildcard = searchName.match(/^(.*_)xx(_.*)$/i);
  if (!wildcard) return null;
  const [, prefix, suffix] = wildcard;
  const searchText = prefix.replace(/_$/, "") || suffix.replace(/^_/, "");
  const rows = await queryCoursewareRows(searchText, 1000);
  const pattern = new RegExp(`^${escapeRegExp(prefix)}\d{2,3}${escapeRegExp(suffix)}$`);
  return rows.filter((row) => pattern.test(row.game_url));
}
async function querySingleCourseware(code) {
  const result = await postJson(LIST_URL, queryPayload(code));
  const rows = result?.out?.list || [];
  const excludeHw = !code.endsWith("_hw");
  const exact = rows.filter((row) => row.game_url === code && (excludeHw ? !row.game_url.endsWith("_hw") : true));
  if (exact.length === 1) return exact[0];

  const nameCodeResult = await postJson(NAME_CODE_URL, { namecode: code });
  const nameCodeRows = (nameCodeResult?.data || []).filter((row) => excludeHw ? !row.game_url.endsWith("_hw") : true);
  const nameCodeExact = nameCodeRows.filter((row) => row.game_url === code);
  if (nameCodeExact.length === 1) {
    return { ...nameCodeExact[0], id: nameCodeExact[0].id || nameCodeExact[0].value };
  }

  const errMsg = excludeHw
    ? "编码 " + code + " 未找到（已排除 _hw 后缀课件）。"
    : "编码 " + code + " 未找到。";
  throw new Error(errMsg);
}

async function resolveCoursewareRows(searchName) {
  const normalized = normalizeSearchName(searchName);
  if (!normalized) throw new Error("请输入课件编码。");

  // xx wildcard
  const wildcardRows = await queryWildcardCoursewares(normalized);
  if (wildcardRows && wildcardRows.length > 0) return wildcardRows;

  // 01~50 range
  const rangeCodes = expandRangePattern(normalized);
  if (rangeCodes) {
    const rows = [];
    for (const code of rangeCodes) {
      try {
        const row = await querySingleCourseware(code);
        if (row) rows.push(row);
      } catch (e) {
        // skip non-existent codes
      }
    }
    if (rows.length > 0) return rows;
  }

  // Exact match
  const row = await querySingleCourseware(normalized);
  return row ? [row] : [];
}


/* ─── 获取详情并只修改语种 ─── */

/**
 * 从 add_edit_chapter_new 响应中提取课件详情对象
 * 响应可能是 { data: {...} } 或 { out: {...} } 或直接对象
 */
function extractDetail(result) {
  if (!result || typeof result !== "object") return null;
  // 先尝试常见的包装格式
  if (result.data && typeof result.data === "object" && !Array.isArray(result.data)) return result.data;
  if (result.out && typeof result.out === "object" && !Array.isArray(result.out)) return result.out;
  // 检查是否有 info/succ 标记（API 包装格式）
  if (result.info === "succ" || result.code === 0 || result.ret === 0) {
    // 排除这些包装字段，看看是否还有内容字段
    const content = { ...result };
    delete content.info; delete content.code; delete content.ret; delete content.data; delete content.out;
    const keys = Object.keys(content);
    if (keys.length > 0) return content;
  }
  return result;
}

async function getChapterDetail(id, cnIds) {
  const result = await postJson(DETAIL_URL, { id, cn_ids: cnIds });
  const detail = extractDetail(result);
  if (!detail || typeof detail !== "object") {
    throw new Error(`获取课件详情失败：${JSON.stringify(result).slice(0, 300)}`);
  }
  return detail;
}

/**
 * 确保 cn_ids 在 data 对象中是嵌套数组格式 [[pid, sid, cn_id]]
 * add_edit_chapter_new 的详情通常从 chapter.chapter_one 获取完整路径
 * 如果只有简单字符串 cn_id，也包装成 [[cn_id]] 格式
 */
function ensureCnIdsFormat(detail, fallbackCnId) {
  // 如果已经有嵌套数组格式，直接返回
  if (Array.isArray(detail.cn_ids) && detail.cn_ids.length > 0 && Array.isArray(detail.cn_ids[0])) {
    return;
  }

  // 尝试从 chapter.chapter_one 构建完整路径
  const chapterOne = detail?.chapter?.chapter_one;
  if (Array.isArray(chapterOne) && chapterOne.length > 0) {
    const paths = [];
    for (const level1 of chapterOne) {
      for (const level2 of level1?.children || []) {
        for (const level3 of level2?.children || []) {
          paths.push([String(level1.value), String(level2.value), String(level3.value)]);
        }
      }
    }
    if (paths.length > 0) {
      detail.cn_ids = paths;
      return;
    }
  }

  // 如果是简单字符串，包装成嵌套数组
  const rawCnId = detail.cn_ids || fallbackCnId;
  if (rawCnId) {
    detail.cn_ids = [[String(rawCnId)]];
  }
}

async function updateSingleChapterLanguage(row, targetLanguageValue) {
  const code = row.game_url;
  const id = row.id;
  const cnIds = row.cn_ids || "";

  if (!id) throw new Error(`${code} 缺少 id。`);

  // 1. 获取完整详情（保证不丢失任何字段）
  let detail;
  try {
    detail = await getChapterDetail(id, cnIds);
  } catch (error) {
    // 如果获取详情失败，用列表数据作为备选（至少包含大部分字段）
    detail = { ...row };
  }

  // 2. 确保 cn_ids 格式正确
  ensureCnIdsFormat(detail, cnIds);

  // 3. 只修改语种字段，其他一切不动！
  detail.chapter_language_type = targetLanguageValue;

  // 4. 保存：data 需要 JSON.stringify，cn_ids 作为外层独立参数
  //    注意：data 必须是字符串（参考监听数据中保存请求的格式）
  const savePayload = {
    data: JSON.stringify(detail),
    cn_ids: cnIds
  };

  const saved = await postJson(SAVE_URL, savePayload);
  const ok = saved?.code === 0 || saved?.ret === 0 || saved?.info === "succ";
  if (!ok) throw new Error(`保存失败：${JSON.stringify(saved).slice(0, 500)}`);
  return { ok: true, code };
}

/* ─── 进度发送 ─── */

function sendProgress(stage, payload = {}) {
  chrome.runtime.sendMessage({ type: "UPDATE_LANGUAGE_PROGRESS", stage, ...payload }).catch(() => {});
}

/* ─── 消息处理 ─── */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 健康检查
  if (message.type === "HEALTH_CHECK") {
    sendResponse({ ok: sessionId ? true : false });
    return false;
  }

  if (message.type !== "UPDATE_LANGUAGE") return false;

  const { searchName, targetLanguage } = message;
  if (!searchName || !targetLanguage) {
    sendResponse({ ok: false, error: "缺少 searchName 或 targetLanguage 参数。" });
    return false;
  }

  (async () => {
    try {
      sendProgress("scan", { message: "正在扫描匹配数据..." });

      // 1. 解析匹配的课件
      const rows = await resolveCoursewareRows(searchName);
      const total = rows.length;
      if (total === 0) {
        sendResponse({ ok: false, error: `编码 ${searchName} 未找到任何匹配课件。` });
        return;
      }

      sendProgress("scanned", { total, message: `已扫描到 ${total} 条课件。` });

      // 2. 逐条修改语种
      const results = [];
      for (const [index, row] of rows.entries()) {
        const current = index + 1;
        const code = row.game_url || "";
        sendProgress("processing", {
          total, current, code,
          message: `正在处理 ${current}/${total}：${code}`
        });

        try {
          const result = await updateSingleChapterLanguage(row, targetLanguage);
          result.row = current;
          results.push(result);
          sendProgress("progress", {
            total, current, code,
            message: `✅ ${code} 语种修改成功（${current}/${total}）`
          });
        } catch (error) {
          results.push({ ok: false, row: current, code, error: String(error.message || error) });
          sendProgress("progress", {
            total, current, code,
            message: `❌ ${code} 修改失败：${error.message || error}`
          });
        }
      }

      // 3. 返回结果
      const successCount = results.filter((r) => r.ok).length;
      sendResponse({
        ok: successCount > 0,
        total,
        success: successCount,
        fail: total - successCount,
        results
      });
    } catch (error) {
      sendResponse({ ok: false, error: String(error.message || error) });
    }
  })();

  return true; // 异步响应
});
