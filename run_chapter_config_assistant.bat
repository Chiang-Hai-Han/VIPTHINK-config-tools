@echo off
chcp 65001 >nul
echo ========================================
echo  讲次配置助手
echo ========================================
echo.
echo 1. 启动本地助手 (端口 8768)
echo 2. 请手动在 Chrome 中加载测试扩展：
echo    chrome://extensions → 加载已解压的扩展
echo    选择: chrome_extension_chapter_test 文件夹
echo.
echo 3. 打开课件管理页面刷新一次，让插件捕获登录状态
echo 4. 点击扩展图标 → 讲次配置工具 → 开始配置
echo.
echo 先编辑 讲次配置表.xlsx，填入要配置的讲次。
echo ========================================
echo.
python "%~dp0local_chapter_config_assistant.py"
pause
