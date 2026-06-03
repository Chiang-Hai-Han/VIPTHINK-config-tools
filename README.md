# VIPTHINK 教研配置助手

> 豌豆思维教研后台（jy.vipthink.cn）自动化配置工具集，用于批量完成课件上架前后、讲次关联、语种修改等配置操作。

---

## 目录

- [项目结构](#项目结构)
- [功能一：课件上架前配置](#功能一课件上架前配置)
- [功能二：讲次配置](#功能二讲次配置)
- [功能三：批量语种修改](#功能三批量语种修改)
- [功能四：上架后配置](#功能四上架后配置)
- [接口监听工具](#接口监听工具)
- [环境准备 & 启动方式](#环境准备--启动方式)

---

## 项目结构

`
自动配置工具/
├── chrome_extension/                   # Chrome 插件 — 课件上架前/后统一配置
│   ├── manifest.json                   #   插件清单（权限、宿主页面）
│   ├── background.js                   #   核心后台逻辑（API 调用、OSS 上传、资源复制）
│   ├── popup.html / popup.js           #   主弹窗界面（上传、复制、知识模块、小老师）
│   ├── chapter_config.js               #   讲次配置逻辑（查询、关联、保存）
│   ├── chapter_config_popup.html / js  #   讲次配置弹窗
│   └── oss-sign.js                     #   OSS 签名模块
│
├── batch_language_updater/             # Chrome 插件 — 批量语种修改（独立）
│   ├── manifest.json
│   ├── background.js                   #   搜索匹配 + 语种更新 API
│   ├── popup.html                      #   直接展示搜索框 + 语种选择 + 执行按钮
│   └── popup.js                        #   弹窗交互与进度显示
│
├── local_prelaunch_assistant.py        # 本地服务 — 课件上架前/后助手（端口 8769）
├── local_chapter_config_assistant.py   # 本地服务 — 讲次配置助手（端口 8770）
├── create_prelaunch_config_sheet.py    # 工具 — 生成课件上架前配置 Excel 模板
│
├── listen_language_update.py           # 调试 — 监听语种修改接口
├── listen_chapter_number_requests.py   # 调试 — 监听讲次配置接口
├── listen_small_teacher_requests.py    # 调试 — 监听小老师配置接口
│
├── resource-copy-template.json         # 配置 — 资源复制 API 模板
├── run_prelaunch_assistant.bat         # 快捷启动
├── run_chapter_config_assistant.bat    # 快捷启动
│
├── 待上传图片文件夹/                     # 封面图片（拖入后自动识别）
├── 待上传小老师图片文件夹/                # 小老师素材图片
├── 课件数据/                            # 课件详情缓存 Excel
├── 课件上架前配置表.xlsx                 # 上架前任务清单
├── 课件上架后配置表.xlsx                 # 上架后任务清单
├── 小老师配置表.xlsx                     # 小老师任务清单
└── 讲次配置表.xlsx                      # 讲次任务清单
`

---

## 功能一：课件上架前配置

### 实现方式
chrome_extension/background.js（Chrome 插件后台） + local_prelaunch_assistant.py（本地 Python 服务，端口 8769）

### 核心子功能

| 功能 | 入口（插件 popup） | 说明 |
|------|-------------------|------|
| **封面图片上传** | 「上架前配置」→「开始上传 / 空跑」 | 从「待上传图片文件夹」读取图片 → 上传到阿里云 OSS → 调用 dd_attachment 关联课件记录 → 可先用「空跑」预览不实际写入 |
| **课件关联** | 「上架前配置」→「关联配置 / 空跑」 | 读取 Excel 中的作业课件编码 → 调用 get_chapter_name_code 查询 → edit_online_work_new 关联 |
| **资源复制** | 「上架前配置」→「资源复制 / 空跑」 | 从粤语课件（\_YY）复制作业题目、学习报告、课件资源到台湾课件（\_TW），保留目标课件已有的资源 |
| **课件信息复制** | 「数据复制」→「复制课件信息」 | 输入编码 → 调用 chapter_list 搜索 → 导出课件名称、编码、封面、教学目标等到本地 Excel（课件数据/） |
| **一键填表** | 「数据复制」→「一键填表」 | 用最近一次课件数据 + 用户选择的语种/科目/类型/难度/版本 → 生成导入模板表，并下载封面 |
| **小老师复制** | 「数据复制」→「小老师复制」 | 搜索编码 → 调用小老师接口获取建议主题、录制建议、图片资源 → 导出到 Excel（课件数据/小老师xxx/） |

### 使用流程

1. 在 Excel 中填写任务清单（课件上架前配置表.xlsx）：课件编码、封面图片、作业编码、来源课件
2. 把封面图片拖入「待上传图片文件夹」（图片文件名需包含课件编码）
3. 双击 
un_prelaunch_assistant.bat 启动本地助手
4. 在 Chrome 打开 jy.vipthink.cn 并登录，点击插件图标
5. 依次点击「开始上传」→「关联配置」→「资源复制」

**安全提示**：每个写入操作前都可先用「空跑」按钮预览结果。

---

## 功能二：讲次配置

### 实现方式
chrome_extension/chapter_config.js + local_chapter_config_assistant.py（本地 Python 服务，端口 8770）

### 功能说明

| 功能 | 插件入口 | 说明 |
|------|---------|------|
| **开始配置** | 「讲次自动配置」→「开始配置」 | 读取 讲次配置表.xlsx → 调用 chapter_number_list_new 查询讲次 → 调用 edit_chapter_number 关联课件、配置名称/故事场景/上课人数 |
| **复制配置** | 「讲次自动配置」→「复制配置」 | 从粤语讲次复制知识模块、益智目标、核心能力到台湾讲次 |

### 讲次配置表格式

| 列 | 说明 |
|----|------|
| 讲次ID(cn_id) | 讲次唯一 ID |
| 课类 | 课程分类 |
| 关联课件 | 讲次关联的课件编码 |
| 讲次名称 | 讲次显示名称 |
| 故事场景 | 讲次故事场景描述 |
| 上课人数 | 默认 8 人 |
| 粤语讲次代码 | 粤语参考讲次（仅复制配置时需要） |

### 使用流程

1. 在 Excel 填写讲次配置表
2. 双击 
un_chapter_config_assistant.bat 启动本地助手
3. 点击插件图标 → 「讲次配置工具 By 海瀚」
4. 点击「开始配置」（或「复制配置」）

---

## 功能三：批量语种修改

### 实现方式
独立插件 atch_language_updater/（**不与主配置插件代码混合**）

### 语种选项

| 显示值 | 接口值 | 应用场景 |
|--------|--------|----------|
| 简体&普通话 | 1 | 大陆版本 |
| 繁体&粤语 | 2 | 香港粤语版本 |
| 英语；英语 | 3 | 国际英文版本 |
| 繁体&台湾普通话 | 4 | 台湾版本（默认选中） |

### 搜索规则

| 输入示例 | 匹配结果 |
|----------|----------|
| s4_v8_01_TW | 精确匹配 s4_v8_01_TW（**不**匹配 _hw） |
| s4_v8_xx_TW | 匹配 s4_v8_01_TW ～ s4_v8_99_TW |
| s4_v8_01~50_TW | 匹配 s4_v8_01_TW ～ s4_v8_50_TW |
| s4_v8_01_TW_hw | 精确匹配 _hw 后缀课件 |
| s4_v8_xx_TW_hw | 匹配所有 _hw 后缀课件 |

### 核心设计

- **只修改语种字段**（chapter_language_type），其他所有配置（课件内容、作业、报告、资源等）**完全不动**
- 操作流程：搜索匹配 → 调用 dd_edit_chapter_new 获取完整详情 → 只替换 chapter_language_type → 调用 dd_edit_chapter 保存
- 默认目标语种为「繁体&台湾普通话」，直接打开即用

### 使用流程

1. Chrome 扩展管理页加载 atch_language_updater/ 文件夹
2. 在 jy.vipthink.cn 先刷新一次课件列表（让插件捕获 Session-Id）
3. 点击插件图标 → 输入编码 → 选择目标语种 → 点击「开始修改」
4. 插件实时显示进度，完成后打印汇总

---

## 功能四：上架后配置

### 实现方式
chrome_extension/background.js + local_prelaunch_assistant.py（与上架前同一个助手）

### 子功能

| 功能 | 插件入口 | 说明 |
|------|---------|------|
| **知识点复制** | 「上架后配置」→「查询本地 / 自动匹配」 | 查询本地：读取 课件上架后配置表.xlsx → 从粤语课件复制知识模块到台湾课件；自动匹配：输入编码，自动粤→台匹配 |
| **小老师上传** | 「上架后配置」→「从本地上传 / 自动匹配」 | 读取 小老师配置表.xlsx → 调用小老师 API 上传建议主题和录制建议；自动匹配模式支持粤→台 |

### 上架后配置表格式

**课件上架后配置表.xlsx**：课件编码 | 资源来源课件 | 知识点复制状态 | 小老师上传状态 | 备注

**小老师配置表.xlsx**：课件编码 | 建议主题 | 录制建议 | 图片资源 | 上传状态 | 备注

---

## 接口监听工具

项目包含三个监听脚本，用于开发调试时捕获后台 API 请求：

| 脚本 | 用途 | 输出目录 |
|------|------|----------|
| listen_language_update.py | 监听课件保存接口（dd_edit_chapter），分析语种修改请求格式 | 语种修改接口监听/ |
| listen_chapter_number_requests.py | 监听讲次配置接口（edit_chapter_number、chapter_number_list_new） | 讲次接口监听/ |
| listen_small_teacher_requests.py | 监听小老师相关接口 | 小老师接口监听/ |

使用方式：直接运行 python listen_xxx.py，会在调试浏览器中打开 jy.vipthink.cn，用户操作后自动捕获网络请求并保存为 JSON。

---

## 环境准备 & 启动方式

### 依赖

`ash
pip install openpyxl   # Excel 读写
`

Python 标准库已覆盖其余依赖（http.server, json, urllib, pathlib, threading 等）。

### 启动

`ash
# 课件上架前/后配置助手（端口 8769）
python local_prelaunch_assistant.py

# 讲次配置助手（端口 8770）
python local_chapter_config_assistant.py

# 或双击 bat 文件
run_prelaunch_assistant.bat
run_chapter_config_assistant.bat
`

### 加载 Chrome 插件

1. Chrome → chrome://extensions/ → 开启「开发者模式」
2. 「加载已解压的扩展程序」→ 选择 chrome_extension/ 文件夹
3. 同样方式加载 atch_language_updater/（两个独立插件）

---

## 技术架构

`
┌──────────────────────────────────────────────┐
│  Chrome 浏览器                                │
│  ┌─────────────┐  ┌──────────────────────┐   │
│  │ 主配置插件    │  │ 语种修改插件（独立）   │   │
│  │ popup.html  │  │ popup.html           │   │
│  │ background  │  │ background.js        │   │
│  │ .js         │  │                      │   │
│  └──────┬──────┘  └──────────┬───────────┘   │
│         │                    │               │
│    监听/捕获              session-id          │
│    session-id           直接 API 调用          │
│         │                    │               │
│        HTTP                  HTTP             │
└─────────┼────────────────────┼───────────────┘
          │                    │
    ┌─────▼─────┐     ┌───────▼────────┐
    │ 本地服务1  │     │   VIPTHINK API  │
    │ 端口 8769 │     │  jy.vipthink   │
    │ 端口 8770 │     │  .cn/gateway   │
    └───────────┘     └────────────────┘
`

---

## 作者

**海瀚（Chiang-Hai-Han）**

---

## License

内部工具，未开源。
