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

call %PYTHON_CMD% "%~dp0create_topic_video_config_sheet.py"
pause
