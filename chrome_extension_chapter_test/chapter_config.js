const LOCAL = "http://127.0.0.1:8768";
const BASE = "https://jy.vipthink.cn/gateway/route__jy/api_admin.php/core";
const LIST_URL = `${BASE}/route__edu_core/teacher_new/chapter_number_list_new`;
const RELATION_LIST_URL = `${BASE}/teacher_new/get_chapter_relation_list`;
const EDIT_URL = `${BASE}/teacher_new/edit_chapter_number`;

let sessionId = "";

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
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Accept": "application/json, text/plain, */*",
      "Content-Type": "application/json;charset=UTF-8",
      "Session-Id": sid
    },
    body: JSON.stringify(data)
  });
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  if (!response.ok) throw new Error(`${response.status} ${url}: ${text.slice(0, 500)}`);
  return parsed;
}

function sendProgress(message, payload = {}) {
  chrome.runtime.sendMessage({ type: "CHAPTER_CONFIG_PROGRESS", message, ...payload }).catch(() => {});
}

/**
 * 查询讲次列表，找到指定编号（如 S4_7）的讲次记录
 */
async function findLectureByNumber(number, cate_pid, cate_sid) {
  // 先尝试在默认分类下查询
  const payload = {
    page: 1,
    page_size: 100,
    total: 0,
    cate_sid: cate_sid || "",
    cate_pid: cate_pid || "",
    subject_ids: "0",
    textbook_name: "",
    difficulty: "-1",
    keyword: number,
    month: "-1",
    status: "",
  };
  if (cate_pid && cate_sid) {
    payload.course_category_id = `${cate_pid},${cate_sid}`;
  }

  const result = await postJson(LIST_URL, payload);
  const list = result?.list || [];
  const exact = list.find((item) => item.number === number);
  if (exact) return exact;

  // 如果没找到，尝试翻页
  const total = result?.page_info?.total || list.length;
  const pageSize = 100;
  const totalPages = Math.ceil(total / pageSize);
  for (let p = 2; p <= totalPages; p++) {
    payload.page = p;
    const pageResult = await postJson(LIST_URL, payload);
    const pageList = pageResult?.list || [];
    const match = pageList.find((item) => item.number === number);
    if (match) return match;
  }
  throw new Error(`未找到讲次编码 ${number}，请检查讲次编码是否正确。`);
}

/**
 * 查询可关联的课件列表，获取课件ID
 */
async function findCoursewareByCode(nameCode) {
  const result = await postJson(RELATION_LIST_URL, { name_code: nameCode });
  const data = result?.data || [];
  // 找第一个精确匹配 game_url 的记录（排除 _hw 后缀）
  const exact = data.find((item) => item.game_url === nameCode);
  if (exact) return exact;
  // 否则取第一条
  if (data.length > 0) return data[0];
  throw new Error(`未找到课件编码 ${nameCode} 对应的课件。`);
}

/**
 * 构建 edit_chapter_number 的保存参数
 */
function buildSavePayload(lecture, courseware, updates) {
  // 从当前讲次记录构建 data 对象
  const data = { ...lecture };

  // 更新字段
  if (updates.number_name !== undefined) data.number_name = updates.number_name;
  if (updates.story !== undefined) data.story = updates.story;
  if (updates.student_limit !== undefined) data.student_limit = String(updates.student_limit);
  if (updates.chapter_id !== undefined) data.chapter_id = String(updates.chapter_id);
  if (updates.chapter_name !== undefined) data.chapter_name = updates.chapter_name;

  // 保存旧的课件ID到 chapter_cancel（如果关联的课件变了）
  const oldChapterId = String(lecture.chapter_id || "0");
  const newChapterId = String(courseware.id);
  const chapterCancel = (oldChapterId !== "0" && oldChapterId !== newChapterId) ? oldChapterId : "";

  return {
    id: String(lecture.id),
    data: JSON.stringify(data),
    chapter_id: newChapterId,
    textbook_id: lecture.textbook_id || null,
    chapter_cancel: chapterCancel,
    textbook_cancel: 1,
    chapter_ai_id: "0",
    ai_class_chapter_id: lecture.ai_class_chapter_id || "",
    remedial_hours: Number(lecture.remedial_hours || 0),
    is_light_review: String(lecture.is_light_review || "0"),
  };
}

/**
 * 处理单个讲次配置任务
 */
async function processChapterConfigTask(task) {
  const code = task["讲次ID(cn_id)"];
  const coursewareCode = task.关联课件;
  const numberName = task.讲次名称;
  const story = task.故事场景;
  const studentLimit = task.上课人数;

  sendProgress(`正在处理讲次：${code}`);

  // 1. 查找讲次记录
  sendProgress(`正在查找讲次：${code}`);
  const lecture = await findLectureByNumber(code);
  sendProgress(`已找到讲次：${code}，ID=${lecture.id}，当前课件ID=${lecture.chapter_id || "无"}`);

  // 2. 查找要关联的课件
  let courseware = null;
  let chapterName = lecture.chapter_name || "";
  if (coursewareCode) {
    sendProgress(`正在查找课件：${coursewareCode}`);
    courseware = await findCoursewareByCode(coursewareCode);
    chapterName = courseware.name || `${courseware.chapter_name}(${courseware.game_url})`;
    sendProgress(`已找到课件：${coursewareCode}，ID=${courseware.id}`);
  }

  // 3. 构建保存参数
  const updates = {};
  if (numberName) updates.number_name = numberName;
  if (story) updates.story = story;
  if (studentLimit) updates.student_limit = String(studentLimit);
  if (courseware) {
    updates.chapter_id = courseware.id;
    updates.chapter_name = chapterName;
  }

  const payload = buildSavePayload(lecture, courseware || { id: lecture.chapter_id }, updates);

  sendProgress(`正在保存讲次配置：${code}`);
  const saved = await postJson(EDIT_URL, payload);
  if (saved?.code !== 0 && saved?.ret !== 0 && saved?.info !== "succ") {
    throw new Error(`保存失败：${JSON.stringify(saved)}`);
  }

  sendProgress(`讲次配置成功：${code}`);

  return {
    ok: true,
    "讲次ID(cn_id)": code,
    讲次ID: String(lecture.id),
    课件ID: courseware ? String(courseware.id) : String(lecture.chapter_id || ""),
    课件名称: chapterName,
    配置状态: "成功",
    备注: numberName ? `已配置：${numberName}` : "已配置",
  };
}

/**
 * 主流程：读取配置表并逐条处理
 */
async function runChapterConfig() {
  sendProgress("正在读取讲次配置表...");

  const response = await fetch(`${LOCAL}/tasks`);
  if (!response.ok) throw new Error(`讲次配置助手未启动（端口 ${LOCAL}）。`);
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || "读取配置失败。");
  const tasks = payload.tasks || [];

  if (tasks.length === 0) {
    sendProgress("配置表为空，请先填写讲次配置表。");
    return { ok: true, count: 0, results: [] };
  }

  sendProgress(`共 ${tasks.length} 条配置任务`);

  const results = [];
  for (const [index, task] of tasks.entries()) {
    try {
      // 跳过已配置的
      if (task.配置状态 === "成功") {
        results.push({
          ok: true,
          skipped: true,
          "讲次ID(cn_id)": task["讲次ID(cn_id)"],
          配置状态: "已跳过",
          备注: "之前已配置成功",
        });
        sendProgress(`已跳过 ${task["讲次ID(cn_id)"]}（之前已配置成功）`);
        continue;
      }

      const result = await processChapterConfigTask(task);
      result.row = task.row;
      results.push(result);

      // 上报结果到本地
      await fetch(`${LOCAL}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tasks: [{
            row: task.row,
            "讲次ID(cn_id)": task["讲次ID(cn_id)"],
            关联课件: task.关联课件,
            讲次名称: task.讲次名称,
            故事场景: task.故事场景,
            上课人数: task.上课人数,
            粤语讲次代码: task.粤语讲次代码,
            配置状态: result.配置状态,
            讲次ID: result.讲次ID || "",
            课件ID: result.课件ID || "",
            课件名称: result.课件名称 || "",
            备注: result.备注 || "",
            错误信息: result.错误信息 || "",
          }]
        }),
      });
    } catch (error) {
      sendProgress(`讲次 ${task["讲次ID(cn_id)"]} 配置失败：${error.message || error}`);

      const failResult = {
        ok: false,
        row: task.row,
        "讲次ID(cn_id)": task["讲次ID(cn_id)"],
        配置状态: "失败",
        错误信息: String(error.message || error),
      };
      results.push(failResult);

      await fetch(`${LOCAL}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tasks: [{
            row: task.row,
            "讲次ID(cn_id)": task["讲次ID(cn_id)"],
            关联课件: task.关联课件,
            讲次名称: task.讲次名称,
            故事场景: task.故事场景,
            上课人数: task.上课人数,
            粤语讲次代码: task.粤语讲次代码,
            配置状态: "失败",
            讲次ID: "",
            课件ID: "",
            课件名称: "",
            备注: "",
            错误信息: failResult.错误信息,
          }]
        }),
      });
    }
  }

  const successCount = results.filter((r) => r.ok).length;
  sendProgress(`配置完成：成功 ${successCount}/${results.length} 条`);

  return { ok: results.every((r) => r.ok), count: results.length, results };
}

// 消息监听
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_CHAPTER_CONFIG") {
    runChapterConfig()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
    return true;
  }
  return false;
});
