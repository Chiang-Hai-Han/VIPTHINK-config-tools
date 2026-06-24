@echo off
setlocal

set "PYTHON_CMD="

python --version >nul 2>nul && set "PYTHON_CMD=python"
if not defined PYTHON_CMD (
  py -3 --version >nul 2>nul && set "PYTHON_CMD=py -3"
)

if not defined PYTHON_CMD (
  echo [ERROR] Python was not found.
  pause
  exit /b 1
)

echo ========================================
echo Topic Video Request Listener
echo ========================================
echo 1. A debug browser will open.
echo 2. Login to jy.vipthink.cn.
echo 3. Manually do one full copy/upload flow.
echo 4. Wait for the capture file to be saved.
echo ========================================
echo.

call %PYTHON_CMD% "%~dp0listen_topic_video_requests.py"
pause
