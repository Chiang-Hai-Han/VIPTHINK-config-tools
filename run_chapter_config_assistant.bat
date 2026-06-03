@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "PORT=8770"

:: 自动查找 Python
set "PYTHON_EXE="
for %%P in (python.exe python3.exe) do (
    where %%P >nul 2>nul
    if !errorlevel!==0 (
        set "PYTHON_EXE=%%P"
        goto :found
    )
)
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
        goto :found
    )
)

echo 未找到 Python，请先运行 setup.bat 检查环境。
pause
exit /b 1

:found
rem 清除端口占用
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:"127\.0\.0\.1:%PORT% .*LISTENING"') do (
  if not "%%P"=="0" taskkill /PID %%P /F >nul 2>nul
)

echo ========================================
echo  讲次配置助手（端口 %PORT%）
echo ========================================
echo.
echo 使用说明：
echo 1. 编辑 讲次配置表.xlsx 填入要配置的讲次
echo 2. 在 Chrome 加载扩展 chrome_extension 文件夹
echo 3. 打开 jy.vipthink.cn 登录，刷新一次页面
echo 4. 点击插件 icon → 讲次配置工具 → 开始配置
echo.
echo 按任意键启动本地助手...
pause >nul

"%PYTHON_EXE%" "%~dp0local_chapter_config_assistant.py"
pause
