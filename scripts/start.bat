@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0.."

where py >nul 2>&1
if %ERRORLEVEL% equ 0 (
  py -3.13 -c "import sys; sys.exit(0 if sys.version_info[:2]>=(3,10) else 1)" 2>nul
  if %ERRORLEVEL% equ 0 (
    py -3.13 scripts\start.py %*
    exit /b %ERRORLEVEL%
  )
  py -3.12 -c "import sys; sys.exit(0 if sys.version_info[:2]>=(3,10) else 1)" 2>nul
  if %ERRORLEVEL% equ 0 (
    py -3.12 scripts\start.py %*
    exit /b %ERRORLEVEL%
  )
  py -3.11 -c "import sys; sys.exit(0 if sys.version_info[:2]>=(3,10) else 1)" 2>nul
  if %ERRORLEVEL% equ 0 (
    py -3.11 scripts\start.py %*
    exit /b %ERRORLEVEL%
  )
  py -3.10 -c "import sys; sys.exit(0 if sys.version_info[:2]>=(3,10) else 1)" 2>nul
  if %ERRORLEVEL% equ 0 (
    py -3.10 scripts\start.py %*
    exit /b %ERRORLEVEL%
  )
)

python scripts\start.py %*
exit /b %ERRORLEVEL%
