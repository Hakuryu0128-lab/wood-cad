@echo off
rem  WoodCAD Receiver (portable) - entry point
rem  ASCII only on purpose: Japanese text in .cmd gets mangled depending on the
rem  console code page. All messages for the user are printed by Node (UTF-8).
chcp 65001 >nul
cd /d "%~dp0"
title WoodCAD Receiver

set "TMP=%~dp0tmp"
set "TEMP=%~dp0tmp"
if not exist "%~dp0tmp" mkdir "%~dp0tmp" >nul 2>&1

set "NODE_EXE=%~dp0runtime\node\node.exe"
if not exist "%NODE_EXE%" (
  echo.
  echo   [SETUP NEEDED] runtime\node\node.exe was not found.
  echo   This folder was copied without the runtime. Copy the whole folder again,
  echo   or put node.exe from the "Windows Binary (.zip)" of https://nodejs.org
  echo   into: %~dp0runtime\node\
  echo.
  pause
  exit /b 1
)

"%NODE_EXE%" "%~dp0launcher\main.js"
if errorlevel 1 (
  echo.
  echo   The launcher stopped with an error. See logs\launcher.log
  pause
)
