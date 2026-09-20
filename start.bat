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
REM
REM ⚠️ 不能只 where node.exe —— 本机 PATH 里可能同时装着 v22（WorkBuddy/便携版）和 v24
REM    （系统安装版），而 v22 常排在前面。此时 where 找得到 node，但拿到的是 v22，
REM    vite.config.ts 的 MIN_NODE_MAJOR 守卫会直接抛错，表现为「start.bat 点了没反应」。
REM    这里改为「按版本挑」：先找 v24+，找到就用它的绝对路径；都不满足才报错退出。

set "TANGBAO_NODE="
set "TANGBAO_NPM="

REM ① 优先用 PATH 里的 node —— 但必须验版本（for /f 取版本号再比较主版本）
for /f "tokens=*" %%a in ('node --version 2^>nul') do set "TANGBAO_PATH_NODE_VERSION=%%a"

REM ② 依次尝试常见安装位置（系统安装版优先）
for %%D in (
    "%ProgramFiles%\nodejs"
    "%ProgramFiles(x86)%\nodejs"
    "%LOCALAPPDATA%\Programs\nodejs"
    "%APPDATA%\nvm"
) do (
    if not defined TANGBAO_NODE if exist "%%~D\node.exe" (
        call :tryNode "%%~D"
    )
)

REM ③ 最后再考虑 PATH 里的（版本合规才用）
if not defined TANGBAO_NODE (
    if defined TANGBAO_PATH_NODE_VERSION (
        call :checkVersion "%TANGBAO_PATH_NODE_VERSION%"
        if not errorlevel 1 (
            for /f "tokens=*" %%a in ('where node.exe 2^>nul') do (
                if not defined TANGBAO_NODE set "TANGBAO_NODE=%%a"
            )
            for /f "tokens=*" %%a in ('where npm.cmd 2^>nul') do (
                if not defined TANGBAO_NPM set "TANGBAO_NPM=%%a"
            )
        )
    )
)

if not defined TANGBAO_NODE (
    echo [错误] 未找到 Node.js 24 或更高版本。
    echo        当前 PATH 中的 node 版本为：%TANGBAO_PATH_NODE_VERSION%（不满足要求）
    echo        请安装 Node 24：https://nodejs.org/
    echo.
    echo        提示：本机若已装 v24（如 "C:\Program Files\nodejs"），
    echo        说明是 PATH 顺序问题，把 v24 目录提到 PATH 前面即可。
    goto :failed
)

for /f "tokens=*" %%a in ('"%TANGBAO_NODE%" --version') do set "NODE_VERSION=%%a"
echo [就绪] Node.js %NODE_VERSION%
echo        路径：%TANGBAO_NODE%

if not defined TANGBAO_NPM (
    for %%D in ("%TANGBAO_NODE%") do set "TANGBAO_NPM=%%~dpDnpm.cmd"
)
if not exist "%TANGBAO_NPM%" (
    echo [错误] 未找到 npm：%TANGBAO_NPM%
    goto :failed
)
echo        npm：%TANGBAO_NPM%

REM 把 Node 所在目录提到 PATH 最前，保证 npm run dev 派生的子进程（vite/electron）
REM 也用同一个 v24，而不是又回落到 v22。
for %%D in ("%TANGBAO_NODE%") do set "PATH=%%~dpD;%PATH%"
goto :nodeReady

:tryNode
REM %~1 = 候选目录
if exist "%~1\node.exe" (
    for /f "tokens=*" %%a in ('"%~1\node.exe" --version 2^>nul') do set "TANGBAO_CAND_VERSION=%%a"
    call :checkVersion "%TANGBAO_CAND_VERSION%"
    if not errorlevel 1 (
        set "TANGBAO_NODE=%~1\node.exe"
        set "TANGBAO_NPM=%~1\npm.cmd"
    )
)
exit /b 0

:checkVersion
REM %~1 = 形如 v24.14.0 的版本串。主版本 >= 24 返回 0，否则返回 1。
for /f "tokens=1 delims=." %%m in ("%~1") do set "TANGBAO_MAJOR=%%m"
set "TANGBAO_MAJOR=%TANGBAO_MAJOR:v=%"
if not defined TANGBAO_MAJOR exit /b 1
if %TANGBAO_MAJOR% GEQ 24 exit /b 0
exit /b 1

:nodeReady

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
    call "%TANGBAO_NPM%" install
    if errorlevel 1 (
        echo [错误] 项目依赖安装失败。
        goto :failed
    )
)

echo [启动] 正在启动糖包开发版...
echo        关闭本窗口或按 Ctrl+C 即停止。
echo.
call "%TANGBAO_NPM%" run dev
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
