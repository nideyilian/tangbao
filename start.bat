@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo    糖包 TANGBAO - 开发版启动
echo ========================================
echo.

REM Node 版本硬性要求：vite build / 主进程的 DatabaseSync 需要 Node 24。
REM Node 22 会在构建时报 "DatabaseSync is not exported"，dev 也可能受限。
where node.exe >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Node.js。
    echo 请先安装 Node.js 24：https://nodejs.org/
    goto :failed
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 npm，请检查 Node.js 安装。
    goto :failed
)

for /f "tokens=*" %%a in ('node --version') do set "NODE_VERSION=%%a"
echo [就绪] Node.js %NODE_VERSION%
echo        ^(构建要求 v24；若为 v22 请切换后再跑发布相关命令^)

REM 端口 41731 是糖包的固定预留：dev server + 单实例锁 + leveldb 独占都是排他资源。
REM 已在运行时不重复启动，避免两个实例互相顶掉（同一仓库默认单写线）。
netstat -ano | findstr /R /C:"127.0.0.1:41731 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo.
    echo [提示] 检测到 41731 端口已被占用 —— 糖包开发版可能已经在运行。
    echo        如果窗口没看到，请在任务栏找一下；要强制重启请先关闭现有实例。
    echo.
    set /p "TANGBAO_CONTINUE=仍要继续启动吗？（继续可能与前一个实例互相顶掉）[y/N] "
    if /i not "%TANGBAO_CONTINUE%"=="y" goto :done
)

if not exist "node_modules\electron\package.json" (
    echo [准备] 正在安装项目依赖，请稍候...
    call npm.cmd install
    if errorlevel 1 (
        echo [错误] 项目依赖安装失败。
        goto :failed
    )
)

echo [启动] 正在启动糖包开发版...
echo        关闭本窗口或按 Ctrl+C 即停止。
echo.
call npm.cmd run dev
set "TANGBAO_EXIT_CODE=%ERRORLEVEL%"

if not "%TANGBAO_EXIT_CODE%"=="0" (
    echo.
    echo [错误] 程序启动失败，退出代码：%TANGBAO_EXIT_CODE%
    goto :failed
)

goto :done

:failed
if not defined TANGBAO_NO_PAUSE pause
exit /b 1

:done
if not defined TANGBAO_NO_PAUSE pause
exit /b 0
