const LOCAL = "http://127.0.0.1:8768";
const BASE = "https://jy.vipthink.cn/gateway/route__jy/api_admin.php/core";
const LIST_URL = `${BASE}/route__edu_core/teacher_new/chapter_number_list_new`;
const RELATION_LIST_URL = `${BASE}/teacher_new/get_chapter_relation_list`;
const EDIT_URL = `${BASE}/teacher_new/edit_chapter_number`;
const CATEGORY_URL = `${BASE}/route__edu_core/teacher_new/get_course_category_cascader`;

const logEl = document.getElementById("log");
let _cachedCategories = null; // 分类缓存\n// ========== 覆盖确认弹窗 ==========
let _overwriteState = { all: false };
let _pendingResolve = null;

function showOverwriteDialog(code, dataInfo) {
  return new Promise((resolve) => {
    document.getElementById("overwriteMessage").textContent = code + " 已有 " + dataInfo.label + "，是否覆盖？";
    document.getElementById("overwriteExisting").textContent = "当前内容：" + (dataInfo.value || "已存在");
    document.getElementById("overwriteModal").style.display = "flex";
    _pendingResolve = resolve;
  });
}

async function checkOverwrite(code, dataInfo) {
  if (_overwriteState.all) return true;
  if (!dataInfo.value) return true; // no existing data, skip dialog
  const action = await showOverwriteDialog(code, dataInfo);
  if (action === "cancel") throw new Error("用户取消操作");
  if (action === "all") _overwriteState.all = true;
  return true; // proceed
}

document.getElementById("overwriteOnce").addEventListener("click", () => {
  document.getElementById("overwriteModal").style.display = "none";
  if (_pendingResolve) { _pendingResolve("once"); _pendingResolve = null; }
});
document.getElementById("overwriteAll").addEventListener("click", () => {
  document.getElementById("overwriteModal").style.display = "none";
  if (_pendingResolve) { _pendingResolve("all"); _pendingResolve = null; }
});
document.getElementById("overwriteCancel").addEventListener("click", () => {
  document.getElementById("overwriteModal").style.display = "none";
  if (_pendingResolve) { _pendingResolve("cancel"); _pendingResolve = null; }
});
let _cachedFilteredCats = {}; // 
const healthBtn = document.getElementById("health");
const startBtn = document.getElementById("startConfig");

let logs = [];
function log(text) {
  logs.push(text);
  logEl.textContent = logs.join("\n");
  if (logs.length > 30) logs = logs.slice(-30);
}
function setBusy(b, busy) { b.disabled = busy; b.style.opacity = busy ? "0.65" : ""; }

async function getSessionId() {
  const stored = await chrome.storage.local.get("sessionId");
  if (!stored.sessionId) throw new Error("没有捕捉到 Session-Id。请先刷新课件管理页面。");
  return stored.sessionId;
}

async function postJson(url, data) {
  const sid = await getSessionId();
  const response = await fetch(url, {
    method: "POST",
    headers: { "Accept": "application/json", "Content-Type": "application/json;charset=UTF-8", "Session-Id": sid },
    body: JSON.stringify(data)
  });
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = {}; }
  if (!response.ok) throw new Error(`${response.status}: ${text.slice(0,200)}`);
  const ret = parsed?.ret, code = parsed?.code;
  if ((ret !== undefined && ret !== 0 && ret !== 200) || (code !== undefined && code !== 0 && code !== 200)) {
    throw new Error(`API错误(ret=${ret}): ${parsed?.info || ""} ${(parsed?.msg||[]).join(", ")}`);
  }
  return parsed;
}

/** 解析课程分类树 → 扁平列表 [{cate_pid, cate_sid, label}] */
async function getAllCategories(forceRefresh) {
  if (_cachedCategories && !forceRefresh) return _cachedCategories;
  const result = await postJson(CATEGORY_URL, {});
  const raw = result?.list || result?.data || [];
  const cats = [];
  function walk(nodes, parentLabel) {
    for (const n of nodes) {
      const pid = String(n.pid || n.value || "");
      const sid = String(n.id || n.sid || n.value || "");
      const label = n.label || "";
      const fullLabel = parentLabel ? parentLabel + " / " + label : label;
      const children = n.children || [];
      if (children.length > 0) {
        walk(children, fullLabel);
      } else if (pid && sid) {
        cats.push({ cate_pid: pid, cate_sid: sid, label: fullLabel });
      }
    }
  }
  walk(raw, "");
  _cachedCategories = cats;
  return cats;
}

async function findLectureByCnId(cnId, categoryHint) {
  const allCats = await getAllCategories();
  log(`共 ${allCats.length} 个叶子分类`);

  // 确定要查询的分类列表
  let targetCats = allCats;
  if (categoryHint) {
    const matched = allCats.filter(c => c.label.includes(categoryHint));
    if (matched.length > 0) {
      log(`"${categoryHint}" 匹配到 ${matched.length} 个分类`);
      targetCats = matched;
    } else {
      log(`"${categoryHint}" 无匹配，扫描全部分类`);
    }
  } else {
    log("未指定课类，扫描全部分类（可能较慢）");
  }

  for (const cat of targetCats) {
    const r = await postJson(LIST_URL, {
      page: 1, page_size: 200, total: 0,
      cate_sid: cat.cate_sid, cate_pid: cat.cate_pid,
      subject_ids: "0", textbook_name: "", difficulty: "-1",
      keyword: "", month: "-1", status: "",
      course_category_id: `${cat.cate_pid},${cat.cate_sid}`,
    });
    const list = r?.list || [];
    const match = list.find(item => String(item.id) === String(cnId));
    if (match) {
      log(`✅ ${cat.label} → ${match.number}`);
      return match;
    }
  }
  throw new Error(`未找到 cn_id=${cnId}，已搜索 ${targetCats.length} 个分类。`);
}

async function findCoursewareByCode(nameCode) {
  const result = await postJson(RELATION_LIST_URL, { name_code: nameCode });
  const data = result?.data || [];
  const exact = data.find(item => item.game_url === nameCode);
  if (exact) return exact;
  if (data.length > 0) return data[0];
  throw new Error(`未找到课件 ${nameCode}`);
}

function buildSavePayload(lecture, courseware, updates) {
  const data = { ...lecture };
  // 清理无关字段（避免意外覆盖关联专题等数据）
  delete data.textbook_id;
  delete data.textbook_info;
  delete data.textbook_name;
  delete data.realia;

  // fix type mismatches between list API and save API
  if (!data.ex_info) data.ex_info = [];
  if (typeof data.fit_month === 'string') {
    data.fit_month = data.fit_month ? data.fit_month.split(',') : [];
  }
  if (typeof data.fragment === 'string') data.fragment = Number(data.fragment);
  if (!Array.isArray(data.contentArr)) data.contentArr = [];
  if (!Array.isArray(data.recommendArr)) data.recommendArr = [];
  if (!Array.isArray(data.reviewConfig)) data.reviewConfig = [];

  if (updates.number_name) data.number_name = updates.number_name;
  if (updates.story) data.story = updates.story;
  if (updates.student_limit) data.student_limit = String(updates.student_limit);
  if (updates.chapter_id) data.chapter_id = String(updates.chapter_id);
  if (updates.chapter_name) data.chapter_name = updates.chapter_name;

  const oldId = String(lecture.chapter_id || '0');
  const newId = String(courseware.id);
  const cancel = (oldId !== '0' && oldId !== newId) ? oldId : '';

  return {
    id: String(lecture.id),
    data: JSON.stringify(data),
    chapter_id: newId,
    textbook_id: lecture.textbook_id || null,
    chapter_cancel: cancel,
    textbook_cancel: 1,
    ai_class_chapter_id: lecture.ai_class_chapter_id || '',
    remedial_hours: '0.00',
    is_light_review: String(lecture.is_light_review || '0'),
  };
}
async function processTask(task) {
  const cnId = task["讲次ID(cn_id)"];
  const categoryHint = task.课类 || "";
  const coursewareCode = task.关联课件;
  const numberName = task.讲次名称;
  const story = task.故事场景;
  const studentLimit = task.上课人数;

  log(`\n===== ${cnId} =====`);
  const lecture = await findLectureByCnId(cnId, categoryHint);
  log(`状态: 课件ID=${lecture.chapter_id||"无"}, name="${lecture.number_name}", story="${lecture.story}", limit=${lecture.student_limit}`);

  let courseware = null;
  let chapterName = lecture.chapter_name || "";
  if (coursewareCode) {
    courseware = await findCoursewareByCode(coursewareCode);
    chapterName = courseware.name || `${courseware.chapter_name}(${courseware.game_url})`;
  }

  const updates = {};
  if (numberName) updates.number_name = numberName;
  if (story) updates.story = story;
  if (studentLimit) updates.student_limit = String(studentLimit);
  if (courseware) {
    updates.chapter_id = courseware.id;
    updates.chapter_name = chapterName;
  }

  const _existingFields = [];
  if (updates.number_name && lecture.number_name) _existingFields.push("讲次名称");
  if (updates.story && lecture.story) _existingFields.push("故事场景");
  if (updates.student_limit && lecture.student_limit > 0) _existingFields.push("上课人数");
  if (_existingFields.length > 0) {
    await checkOverwrite(cnId, { label: _existingFields.join("、"), value: _existingFields.join("、") });
  }

  const payload = buildSavePayload(lecture, courseware || { id: lecture.chapter_id }, updates);
  await postJson(EDIT_URL, payload);
  log(`✅ 成功`);
  return {
    ok: true,
    "讲次ID(cn_id)": cnId, 讲次ID: String(lecture.id),
    课件ID: courseware ? String(courseware.id) : "",
    课件名称: chapterName, 配置状态: "成功",
    备注: numberName ? `已配置：${numberName}` : "已配置",
  };
}

async function run() {
  _overwriteState.all = false; setBusy(startBtn, true); logs = [];
  try {
    log("读取讲次配置表...");
    const resp = await fetch(`${LOCAL}/tasks`);
    if (!resp.ok) throw new Error(`本地助手未启动`);
    const p = await resp.json();
    if (!p.ok) throw new Error(p.error);
    const tasks = p.tasks || [];
    if (!tasks.length) { log("配置表为空。"); return; }
    log(`共 ${tasks.length} 条`);
    const results = [];
    for (const task of tasks) {
      try {
        if (task.配置状态 === "成功") { log(`跳过 ${task["讲次ID(cn_id)"]}`); continue; }
        const result = await processTask(task);
        result.row = task.row; results.push(result);
        await fetch(`${LOCAL}/report`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tasks: [{ row: task.row, "讲次ID(cn_id)": task["讲次ID(cn_id)"], 课类: task.课类, 关联课件: task.关联课件, 讲次名称: task.讲次名称, 故事场景: task.故事场景, 上课人数: task.上课人数, 粤语讲次代码: task.粤语讲次代码, 配置状态: "成功", 讲次ID: result.讲次ID || "", 课件ID: result.课件ID || "", 课件名称: result.课件名称 || "", 备注: result.备注 || "", 错误信息: "" }] }),
        });
      } catch (e) {
        log(`❌ ${task["讲次ID(cn_id)"]}: ${e.message}`);
        results.push({ ok: false, "讲次ID(cn_id)": task["讲次ID(cn_id)"], 错误信息: e.message });
        await fetch(`${LOCAL}/report`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tasks: [{ row: task.row, "讲次ID(cn_id)": task["讲次ID(cn_id)"], 课类: task.课类, 关联课件: task.关联课件, 讲次名称: task.讲次名称, 故事场景: task.故事场景, 上课人数: task.上课人数, 粤语讲次代码: task.粤语讲次代码, 配置状态: "失败", 讲次ID: "", 课件ID: "", 课件名称: "", 备注: "", 错误信息: e.message }] }),
        });
      }
    }
    log(`\n完成：成功 ${results.filter(r=>r.ok).length}/${results.length}`);
  } catch (e) { log(`\n❌ ${e.message}`); }
  finally { setBusy(startBtn, false); }
}

healthBtn.addEventListener("click", async (e) => {
  setBusy(e.currentTarget, true);
  try { log(JSON.stringify(await (await fetch(`${LOCAL}/health`)).json(), null, 2)); }
  catch { log("本地助手未启动。"); }
  finally { setBusy(e.currentTarget, false); }
});
startBtn.addEventListener("click", run);

// ========== 复制配置：知识模块 + 益智目标 + 核心能力 ==========

async function runCopyConfig() {
  _overwriteState.all = false; setBusy(startBtn, true); logs = [];
  try {
    log("读取讲次配置表...");
    const resp = await fetch(`${LOCAL}/tasks`);
    if (!resp.ok) throw new Error("本地助手未启动");
    const p = await resp.json();
    if (!p.ok) throw new Error(p.error);
    const tasks = p.tasks || [];
    if (!tasks.length) { log("配置表为空。"); return; }
    log(`共 ${tasks.length} 条`);
    const results = [];
    for (const task of tasks) {
      try {
        const cnId = task["讲次ID(cn_id)"];
        const srcCode = task.粤语讲次代码;
        const srcCat = task.粤语课类 || "";
        if (!srcCode) { log(`⏭️ ${cnId}: 未填粤语讲次代码，跳过`); continue; }

        log(`\n===== ${cnId}  <- ${srcCode} =====`);

        // 1. 查找来源（粤语）讲次
        log(`查找粤语讲次：${srcCode}`);
        const srcCats = await getAllCategories();
        let srcCatsFiltered = srcCats;
        if (srcCat) {
          srcCatsFiltered = srcCats.filter(c => c.label.includes(srcCat));
          if (srcCatsFiltered.length === 0) srcCatsFiltered = srcCats;
        }
        let srcLecture = null;
        for (const cat of srcCatsFiltered) {
          const r = await postJson(LIST_URL, {
            page: 1, page_size: 200, total: 0,
            cate_sid: cat.cate_sid, cate_pid: cat.cate_pid,
            subject_ids: "0", textbook_name: "", difficulty: "-1",
            keyword: "", month: "-1", status: "",
            course_category_id: `${cat.cate_pid},${cat.cate_sid}`,
          });
          const list = r?.list || [];
          // 支持按讲次数码(number)或按 cn_id(id) 匹配
          const match = list.find(item =>
            String(item.number) === String(srcCode) ||
            String(item.id) === String(srcCode)
          );
          if (match) { srcLecture = match; break; }
        }
        if (!srcLecture) throw new Error(`未找到粤语讲次 ${srcCode}`);
        log(`✅ 来源：${srcLecture.number} course_knowledge="${srcLecture.course_knowledge}" target="${srcLecture.target}"`);

        // 2. 查找目标讲次
        log(`查找目标讲次：${cnId}`);
        const allCats = await getAllCategories();
        let searchCats = allCats;
        const tgtHint = task.课类 || "";
        if (tgtHint) {
          const matched = allCats.filter(c => c.label.includes(tgtHint));
          if (matched.length > 0) searchCats = matched;
        }
        let tgtLecture = null;
        for (const cat of searchCats) {
          const r = await postJson(LIST_URL, {
            page: 1, page_size: 200, total: 0,
            cate_sid: cat.cate_sid, cate_pid: cat.cate_pid,
            subject_ids: "0", textbook_name: "", difficulty: "-1",
            keyword: "", month: "-1", status: "",
            course_category_id: `${cat.cate_pid},${cat.cate_sid}`,
          });
          const list = r?.list || [];
          const match = list.find(item => String(item.id) === String(cnId));
          if (match) { tgtLecture = match; break; }
        }
        if (!tgtLecture) throw new Error(`未找到目标讲次 ${cnId}`);
        log(`✅ 目标：${tgtLecture.number}`);

        // 3. 构建保存参数：用来源的值覆盖目标
        const data = { ...tgtLecture };
  delete data.textbook_id;
  delete data.textbook_info;
  delete data.textbook_name;
  delete data.realia;
        if (!data.ex_info) data.ex_info = [];
        if (typeof data.fit_month === "string") {
          data.fit_month = data.fit_month ? data.fit_month.split(",") : [];
        }
        if (typeof data.fragment === "string") data.fragment = Number(data.fragment);
        if (!Array.isArray(data.contentArr)) data.contentArr = [];
        if (!Array.isArray(data.recommendArr)) data.recommendArr = [];
        if (!Array.isArray(data.reviewConfig)) data.reviewConfig = [];

        // 复制：知识模块 + 益智目标 + 片段
        data.course_knowledge = srcLecture.course_knowledge || "0";
        data.target = srcLecture.target || "0";
        if (srcLecture.fragment !== undefined) data.fragment = Number(srcLecture.fragment);

        // 复制：核心能力目标 → 转为 ex_info 格式（保存API需要）
        if (srcLecture.basic_info && Array.isArray(srcLecture.basic_info.core_target) && srcLecture.basic_info.core_target.length > 0) {
          data.ex_info = srcLecture.basic_info.core_target.map(item => ({
            ability: item.ability,
            star: item.star,
            cn_id: String(tgtLecture.id),
          }));
          // 同时更新 basic_info 中的显示数据
          if (!data.basic_info) data.basic_info = {};
          data.basic_info.core_target = srcLecture.basic_info.core_target.map(item => ({
            ...item,
            cn_id: String(tgtLecture.id),
          }));
          data.basic_info.course_knowledge = srcLecture.basic_info.course_knowledge || data.basic_info.course_knowledge;
          data.basic_info.target = srcLecture.basic_info.target || data.basic_info.target;
        }

        // 4. 保存
        const payload = {
          id: String(tgtLecture.id),
          data: JSON.stringify(data),
          chapter_id: String(tgtLecture.chapter_id || "0"),
          textbook_id: tgtLecture.textbook_id || null,
          chapter_cancel: "",
          textbook_cancel: 1,
          ai_class_chapter_id: tgtLecture.ai_class_chapter_id || "",
          remedial_hours: "0.00",
          is_light_review: String(tgtLecture.is_light_review || "0"),
        };
        const _copyCheck = [];
        if (tgtLecture.course_knowledge > 0) _copyCheck.push("知识模块");
        if (tgtLecture.target > 0) _copyCheck.push("益智目标");
        if (Array.isArray(tgtLecture.ex_info) && tgtLecture.ex_info.length > 0) _copyCheck.push("核心能力");
        if (_copyCheck.length > 0) {
          await checkOverwrite(cnId, { label: _copyCheck.join("、"), value: _copyCheck.join("、") });
        }

        log(`保存：course_knowledge=${data.course_knowledge}, target=${data.target}`);
        log(`core_target: ${Array.isArray(data.basic_info?.core_target) ? data.basic_info.core_target.length + "条" : "无"}${Array.isArray(data.basic_info?.core_target) ? data.basic_info.core_target.length + "条" : "无"}`);

        const saved = await postJson(EDIT_URL, payload);
        log(`✅ ${cnId} 复制完成`);

        results.push({ ok: true, "讲次ID(cn_id)": cnId });
        await fetch(`${LOCAL}/report`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tasks: [{ row: task.row, "讲次ID(cn_id)": cnId, 粤语讲次代码: srcCode, 粤语课类: srcCat, 配置状态: "已复制", 备注: `知识模块=${srcLecture.course_knowledge}, 目标=${srcLecture.target}`, 错误信息: "" }] }),
        });
      } catch (e) {
        log(`❌ ${task["讲次ID(cn_id)"]}: ${e.message}`);
        results.push({ ok: false });
        await fetch(`${LOCAL}/report`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tasks: [{ row: task.row, "讲次ID(cn_id)": task["讲次ID(cn_id)"], 配置状态: "失败", 错误信息: e.message }] }),
        });
      }
    }
    log(`\n完成：成功 ${results.filter(r=>r.ok).length}/${results.length}`);
  } catch (e) { log(`\n❌ ${e.message}`); }
  finally { setBusy(startBtn, false); }
}

// 绑定复制配置按钮
document.getElementById("copyConfig").addEventListener("click", runCopyConfig);





