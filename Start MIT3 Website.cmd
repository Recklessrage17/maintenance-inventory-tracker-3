@echo off
title Start MIT3 Website
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-mit3-website.ps1"
pause
