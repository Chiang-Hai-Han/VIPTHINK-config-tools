@echo off
chcp 65001 >nul 2>nul
setlocal enabledelayedexpansion

set "TITLE=VIPTHINK 教研配置助手 - 一键安装"
title %TITLE%

:: ═══════════════════════════════════════
:: 防止闪退：所有错误都会暂停
:: ═══════════════════════════════════════
if "%VIPTHINK_SETUP_GUARD%"=="1" goto :main
set "VIPTHINK_SETUP_GUARD=1"
call "%~f0" 2>&1
echo.
echo ================================================
echo   安装完成（窗口将在 30 秒后关闭）
echo   或按任意键立即关闭...
echo ================================================
pause >nul
exit /b

:main
echo.
echo ================================================
echo   VIPTHINK 教研配置助手 - 一键安装
echo ================================================
echo.

:: ──────────────────────────────────────
:: 1. 检测 Python
:: ──────────────────────────────────────
echo [Step 1/5] 正在检测 Python...

set "PYTHON_EXE="

:: 方法 A: PATH 中查找
for %%C in (python.exe python3.exe) do (
    for /f "delims=" %%P in ('where %%C 2^>nul') do (
        if exist "%%P" (
            set "PYTHON_EXE=%%P"
            goto :python_found
        )
    )
)

:: 方法 B: 扫描常见安装目录
for %%D in (
    "%LocalAppData%\Programs\Python\Python313"
    "%LocalAppData%\Programs\Python\Python312"
    "%LocalAppData%\Programs\Python\Python311"
    "%LocalAppData%\Programs\Python\Python310"
    "%ProgramFiles%\Python313"
    "%ProgramFiles%\Python312"
    "%ProgramFiles%\Python311"
    "%ProgramFiles%\Python310"
    "C:\Python313"
    "C:\Python312"
    "C:\Python311"
    "C:\Python310"
    "%UserProfile%\AppData\Local\Programs\Python\Python313"
    "%UserProfile%\AppData\Local\Programs\Python\Python312"
    "%UserProfile%\AppData\Local\Programs\Python\Python311"
) do (
    if exist "%%D\python.exe" (
        set "PYTHON_EXE=%%D\python.exe"
        goto :python_found
    )
)

:: 方法 C: 从注册表读取安装路径
for /f "tokens=2*" %%A in ('reg query "HKCU\Software\Python\PythonCore" /s /v "ExecutablePath" 2^>nul ^| findstr "ExecutablePath"') do (
    if exist "%%B" (
        set "PYTHON_EXE=%%B"
        goto :python_found
    )
)
for /f "tokens=2*" %%A in ('reg query "HKLM\Software\Python\PythonCore" /s /v "ExecutablePath" 2^>nul ^| findstr "ExecutablePath"') do (
    if exist "%%B" (
        set "PYTHON_EXE=%%B"
        goto :python_found
    )
)

:: 没找到 Python
echo   [X] 未找到 Python 3.10+
echo.
echo   ▸ 正在尝试通过 winget 自动安装 Python...
where winget >nul 2>nul
if %errorlevel%==0 (
    echo   正在下载安装 Python 3.12（约 25MB，请耐心等待）...
    winget install Python.Python.3.12 --accept-source-agreements --accept-package-agreements --silent 2>nul
    if %errorlevel%==0 (
        echo   [OK] Python 安装完成！
        echo   请重新打开一个命令行窗口，然后再次运行 setup.bat
        echo.
        echo   按任意键退出...
        pause >nul
        exit /b 0
    )
)

echo.
echo   ============================================
echo   未能自动安装 Python，请手动安装：
echo   1. 打开浏览器，访问 https://www.python.org/downloads/
echo   2. 下载 Python 3.11+ 安装程序
echo   3. 安装时务必勾选 "Add Python to PATH"
echo   4. 安装完成后重新运行 setup.bat
echo   ============================================
echo.
echo   按任意键退出...
pause >nul
exit /b 1

:python_found
echo   [OK] Python 路径：!PYTHON_EXE!
"%PYTHON_EXE%" --version 2>&1
if %errorlevel% neq 0 (
    echo   [X] Python 无法运行，请检查安装
    pause
    exit /b 1
)

:: ──────────────────────────────────────
:: 2. 安装 Python 依赖
:: ──────────────────────────────────────
echo.
echo [Step 2/5] 检查并安装 Python 依赖...

echo   ▸ 检查 openpyxl...
"%PYTHON_EXE%" -c "import openpyxl" 2>nul
if %errorlevel% neq 0 (
    echo   ▸ 正在安装 openpyxl...
    "%PYTHON_EXE%" -m pip install openpyxl -q --disable-pip-version-check 2>&1
    if !errorlevel! neq 0 (
        echo   [警告] openpyxl 安装失败，表格功能不可用
        echo   可尝试手动安装: pip install openpyxl
    ) else (
        echo   [OK] openpyxl 安装成功
    )
) else (
    echo   [OK] openpyxl 已安装
)

:: ──────────────────────────────────────
:: 3. 检查项目文件完整性
:: ──────────────────────────────────────
echo.
echo [Step 3/5] 检查项目文件完整性...
cd /d "%~dp0"
set "ALL_OK=1"

echo   --- 核心服务文件 ---
call :check "local_prelaunch_assistant.py"        "本地配置服务（上架前后）" 1
call :check "local_chapter_config_assistant.py"   "本地配置服务（讲次）"     1
call :check "resource-copy-template.json"         "资源复制模板"             1
call :check "批量新增课件模板.xlsx"                 "批量新增模板"             1

echo   --- Chrome 插件：主配置 ---
call :check "chrome_extension\manifest.json"       "插件清单"                 1
call :check "chrome_extension\background.js"       "后台脚本"                 1
call :check "chrome_extension\popup.html"          "弹窗界面"                 1
call :check "chrome_extension\popup.js"            "弹窗逻辑"                 1

echo   --- Chrome 插件：语种修改 ---
call :check "batch_language_updater\manifest.json"  "插件清单"               1
call :check "batch_language_updater\background.js"  "后台脚本"               1
call :check "batch_language_updater\popup.html"     "弹窗界面"               1
call :check "batch_language_updater\popup.js"       "弹窗逻辑"               1

echo   --- 启动脚本 ---
call :check "run_prelaunch_assistant.bat"          "上架前后配置启动脚本"     1
call :check "run_chapter_config_assistant.bat"     "讲次配置启动脚本"         1

echo   --- 配置表（可选） ---
call :check "课件上架前配置表.xlsx"                  "上架前任务清单"          0
call :check "课件上架后配置表.xlsx"                  "上架后任务清单"          0
call :check "小老师配置表.xlsx"                      "小老师任务清单"          0
call :check "讲次配置表.xlsx"                        "讲次任务清单"            0

echo   --- 工作目录 ---
for %%D in ("待上传图片文件夹" "待上传小老师图片文件夹" "课件数据" "待处理数据") do (
    if not exist %%D (
        mkdir %%D >nul 2>nul
        echo   [创建] %%~D
    ) else (
        echo   [OK] %%~D
    )
)

if "%ALL_OK%"=="0" (
    echo.
    echo ================================================
    echo [错误] 有必需文件缺失！
    echo 请确保从 GitHub 完整克隆项目：
    echo git clone https://github.com/Chiang-Hai-Han/VIPTHINK-config-tools.git
    echo ================================================
    pause
    exit /b 1
)
echo   [OK] 所有必需文件检查通过！

:: ──────────────────────────────────────
:: 4. Chrome 扩展加载指引
:: ──────────────────────────────────────
echo.
echo [Step 4/5] Chrome 扩展安装

:: 尝试检测 Chrome/Edge 浏览器
set "BROWSER="
for %%B in (
    "%LocalAppData%\Google\Chrome\Application\chrome.exe"
    "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
    "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
    "C:\Program Files\Google\Chrome\Application\chrome.exe"
) do (
    if exist %%B (
        set "BROWSER=%%B"
        goto :browser_found
    )
)
for %%B in (
    "%LocalAppData%\Microsoft\Edge\Application\msedge.exe"
    "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
) do (
    if exist %%B (
        set "BROWSER=%%B"
        goto :browser_found
    )
)

:browser_found
if defined BROWSER (
    echo   检测到浏览器：!BROWSER!
) else (
    echo   未检测到 Chrome/Edge 浏览器路径
)

echo.
echo   请按以下步骤加载 Chrome 插件：
echo.
echo   (1) 打开 Chrome / Edge 浏览器
echo   (2) 地址栏输入 chrome://extensions/ 并回车
echo        （Edge 浏览器输入 edge://extensions/）
echo   (3) 打开右上角「开发人员模式」开关
echo   (4) 点击「加载解压缩的扩展」
echo        → 选择目录：chrome_extension
echo   (5) 再次点击「加载解压缩的扩展」
echo        → 选择目录：batch_language_updater
echo.
echo   ▸ 是否现在打开 Chrome 扩展管理页？(Y/N)
set /p OPEN_CHROME=
if /i "%OPEN_CHROME%"=="Y" (
    if defined BROWSER (
        start "" "!BROWSER!" chrome://extensions/
        echo   已打开浏览器，请按上方步骤操作。
    ) else (
        echo   未找到浏览器，请手动打开 chrome://extensions/
    )
)

:: ──────────────────────────────────────
:: 5. 完成
:: ──────────────────────────────────────
echo.
echo [Step 5/5] 完成！
echo.
echo ================================================
echo   VIPTHINK 教研配置助手 - 安装成功！
echo ================================================
echo.
echo   ▸ 启动方式：
echo.
echo     A) 课件上架前/后配置：
echo        双击运行  run_prelaunch_assistant.bat
echo.
echo     B) 讲次自动配置：
echo        双击运行  run_chapter_config_assistant.bat
echo.
echo     C) 批量语种修改：
echo        在 Chrome 工具栏点击「批量语种修改」插件图标
echo.
echo   ▸ 使用提示：
echo     - 启动本地助手后，在 jy.vipthink.cn 登录并刷新页面
echo     - 然后点击 Chrome 插件图标开始操作
echo     - 状态日志会显示在插件弹窗底部
echo.
echo ================================================

:: 清除 guard 变量让最终暂停生效
set "VIPTHINK_SETUP_GUARD="
goto :eof

:: ──────────────────────────────────────
:: 子函数：check 文件是否存在
::   %1 = 文件路径（相对于脚本目录）
::   %2 = 描述文字
::   %3 = 1=必需 / 0=可选
:: ──────────────────────────────────────
:check
if exist "%~1" (
    echo   [OK] %~2
) else (
    if "%~3"=="1" (
        echo   [缺少] %~2  ^(%~1^)  ★必需
        set "ALL_OK=0"
    ) else (
        echo   [缺失] %~2  ^(可选^)
    )
)
exit /b 0
