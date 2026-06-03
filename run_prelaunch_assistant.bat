@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "PORT=8769"

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
rem 如果旧实例在运行，先关闭
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:%PORT%/shutdown' -TimeoutSec 2 | Out-Null; Start-Sleep -Milliseconds 700 } catch {}" >nul 2>nul

rem 清除端口占用
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:"127\.0\.0\.1:%PORT% .*LISTENING"') do (
  if not "%%P"=="0" taskkill /PID %%P /F >nul 2>nul
)

echo.
echo ========================================
echo  课件上架前后配置助手（端口 %PORT%）
echo ========================================
echo.
echo  Excel 表格已打开时请先关闭再继续，否则保存可能失败。
echo  按任意键启动本地助手...
pause >nul

"%PYTHON_EXE%" "%~dp0local_prelaunch_assistant.py"
pause
