@echo off
rem Wood CAD submission server (for the school PC)
cd /d "%~dp0"
set "PY="
where py >NUL 2>NUL && set "PY=py -3"
if not defined PY where python >NUL 2>NUL && set "PY=python"
if not defined PY (
  echo [ERROR] Python was not found.
  pause
  exit /b 1
)
echo [INFO] Starting: %PY% woodcad_submit.py
%PY% woodcad_submit.py
echo.
echo [INFO] Server stopped. Check the messages above.
pause
