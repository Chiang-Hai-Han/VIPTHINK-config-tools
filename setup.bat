@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set "TITLE=VIPTHINK 教研配置助手 - 一键安装"
title %TITLE%

echo.
echo ================================================
echo   VIPTHINK 教研配置助手 - 一键安装
echo ================================================
echo.

:: ──────────────────────────────────────
:: 1. 检测 Python
:: ──────────────────────────────────────
set "PYTHON_FOUND=0"
for %%P in (python.exe python3.exe) do (
    where %%P >nul 2>nul
    if !errorlevel!==0 (
        set "PYTHON_EXE=%%P"
        set "PYTHON_FOUND=1"
        goto :python_done
    )
)

:: 尝试常见安装路径
for %%D in (
    "%LocalAppData%\Programs\Python\Python312\python.exe"
    "%LocalAppData%\Programs\Python\Python311\python.exe"
    "%ProgramFiles%\Python312\python.exe"
    "%ProgramFiles%\Python311\python.exe"
    "C:\Python312\python.exe"
    "C:\Python311\python.exe"
) do (
    if exist %%D (
        set "PYTHON_EXE=%%D"
        set "PYTHON_FOUND=1"
        goto :python_done
    )
)

:python_done
if "%PYTHON_FOUND%"=="0" (
    echo [错误] 未找到 Python！
    echo.
    echo 请到 https://www.python.org/downloads/ 下载并安装 Python 3.11+
    echo 安装时请勾选 "Add Python to PATH"
    echo.
    pause
    exit /b 1
)
echo [Step 1/4] Python 已找到：%PYTHON_EXE%
for /f "tokens=*" %%V in ('"%PYTHON_EXE%" --version 2^>^&1') do echo   版本：%%V

:: ──────────────────────────────────────
:: 2. 安装 Python 依赖
:: ──────────────────────────────────────
echo.
echo [Step 2/4] 检查并安装 Python 依赖...
"%PYTHON_EXE%" -c "import openpyxl" 2>nul
if %errorlevel% neq 0 (
    echo   正在安装 openpyxl...
    "%PYTHON_EXE%" -m pip install openpyxl -q
    if !errorlevel! neq 0 (
        echo   [警告] openpyxl 安装失败，课件表格读写功能可能无法使用
    ) else (
        echo   [OK] openpyxl 安装成功
    )
) else (
    echo   [OK] openpyxl 已安装
)

:: ──────────────────────────────────────
:: 3. 检查必要文件和数据目录
:: ──────────────────────────────────────
echo.
echo [Step 3/4] 检查必要文件...
cd /d "%~dp0"

set "ALL_OK=1"

:: 必要文件列表
call :check_file "chrome_extension\manifest.json"         "Chrome 插件（主配置）"
call :check_file "chrome_extension\background.js"         "Chrome 插件后台脚本"
call :check_file "chrome_extension\popup.html"            "Chrome 插件弹窗界面"
call :check_file "chrome_extension\popup.js"              "Chrome 插件弹窗逻辑"
call :check_file "batch_language_updater\manifest.json"   "语种修改插件"
call :check_file "batch_language_updater\background.js"   "语种修改后台脚本"
call :check_file "batch_language_updater\popup.html"      "语种修改弹窗界面"
call :check_file "batch_language_updater\popup.js"        "语种修改弹窗逻辑"
call :check_file "local_prelaunch_assistant.py"           "本地配置服务（上架前后）"
call :check_file "local_chapter_config_assistant.py"      "本地配置服务（讲次）"
call :check_file "resource-copy-template.json"            "资源复制模板"
call :check_file "批量新增课件模板.xlsx"                    "批量新增模板"

if "%ALL_OK%"=="0" (
    echo.
    echo [错误] 上列文件缺失，请确保从 GitHub 完整克隆项目！
    pause
    exit /b 1
)

:: 创建必要目录
for %%D in ("待上传图片文件夹" "待上传小老师图片文件夹" "课件数据" "待处理数据") do (
    if not exist %%D (
        mkdir %%D >nul 2>nul
        echo   [创建目录] %%~D
    )
)

:: 检查可选配置表
echo   --- 配置表（可选，按需创建）---
for %%F in ("课件上架前配置表.xlsx" "课件上架后配置表.xlsx" "小老师配置表.xlsx" "讲次配置表.xlsx") do (
    if exist %%F (
        echo   [OK] %%~F
    ) else (
        echo   [缺失] %%~F   ^(请从空模板新建或复制^)
    )
)

echo.
echo   [OK] 所有必要文件检查通过！

:: ──────────────────────────────────────
:: 4. Chrome 扩展加载指引
:: ──────────────────────────────────────
echo.
echo [Step 4/4] Chrome 扩展安装指引
echo.
echo   请按以下步骤加载两个 Chrome 插件：
echo.
echo   (1) 打开 Chrome 浏览器
echo   (2) 地址栏输入 chrome://extensions/ 并回车
echo   (3) 打开右上角「开发者模式」
echo   (4) 点击「加载已解压的扩展程序」
echo        → 选择目录：%~dp0chrome_extension
echo   (5) 再次点击「加载已解压的扩展程序」
echo        → 选择目录：%~dp0batch_language_updater
echo.
echo   ▸ 是否现在打开 Chrome 扩展管理页？[Y/N]
set /p OPEN_CHROME=
if /i "%OPEN_CHROME%"=="Y" (
    start chrome chrome://extensions/
    echo   已打开 Chrome 扩展管理页，请按上方步骤操作。
)

:: ──────────────────────────────────────
:: 安装完成
:: ──────────────────────────────────────
echo.
echo ================================================
echo   安装完成！
echo ================================================
echo.
echo   启动方式：
echo.
echo   A) 课件上架前后配置：
echo      运行  run_prelaunch_assistant.bat
echo      或手动 python local_prelaunch_assistant.py
echo      然后在 Chrome 中打开 jy.vipthink.cn 使用
echo.
echo   B) 讲次配置：
echo      运行  run_chapter_config_assistant.bat
echo      或手动 python local_chapter_config_assistant.py
echo.
echo   C) 批量语种修改：
echo      直接在 Chrome 点击「批量语种修改」插件图标
echo.
echo   使用前请先在 jy.vipthink.cn 登录并刷新一次页面，
echo   让插件捕获登录 Session-Id。
echo.
pause
exit /b 0

:: ──────────────────────────────────────
:: 子函数：检查文件
:: ──────────────────────────────────────
:check_file
if exist "%~1" (
    echo   [OK] %~2
) else (
    echo   [MISSING] %~2  ^(%~1^)
    set "ALL_OK=0"
)
exit /b 0
